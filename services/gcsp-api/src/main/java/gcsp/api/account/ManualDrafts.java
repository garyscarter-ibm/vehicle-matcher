package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountService.Prepared;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Work;
import gcsp.api.persistence.WorkResult;
import java.io.IOException;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;

/**
 * The employee's manual draft: read, save and discard, matching Node's ManualContextService.readDraft, saveDraft and
 * discardDraft. Every version is one immutable manual_drafts row, so a discard keeps the counter.
 */
public final class ManualDrafts {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String RESOURCE = "manual-draft";
    private static final String PORTS = "manual-draft-store";
    private static final List<String> SAVE_KEYS = List.of("commandId", "expectedDraftVersion", "expectedContextVersion", "choices");
    private static final List<String> DISCARD_KEYS = List.of("commandId", "expectedDraftVersion");

    private static final String LATEST_SQL = "SELECT value::text FROM manual_drafts WHERE environment_id = ? AND run_id = ? "
            + "AND employee_id = ? ORDER BY draft_version DESC LIMIT 1";
    private static final String HOLD_SQL = "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? "
            + "AND employee_id = ? AND slot_id = ? AND hold_type = 'cart' AND state IN "
            + "('active', 'claim-pending', 'release-pending', 'selection-pending', 'allocated') LIMIT 1";
    private static final String RECEIPT_SQL = "SELECT input_digest, result::text FROM command_receipts "
            + "WHERE environment_id = ? AND run_id = ? AND actor_id = ? AND command_id = ?";

    private final AccountService accounts;
    private final DataSource dataSource;
    private final TransactionRunner runner;

    public ManualDrafts(AccountService accounts, DataSource dataSource, TransactionRunner runner) {
        this.accounts = accounts;
        this.dataSource = dataSource;
        this.runner = runner;
    }

    public AccountOutcome read(AccountScope identity) {
        Prepared p = accounts.prepare(identity);
        if (p.error != null) return p.error;
        JsonNode draft;
        try (Connection c = dataSource.getConnection()) {
            draft = latest(c, identity.environmentId(), identity.runId(), identity.employeeId());
        } catch (SQLException | IOException e) {
            return AccountOutcome.unavailable(PORTS);
        }
        if (draft == null || Js.eqBool(draft.get("discarded"))) return AccountOutcome.notFound(RESOURCE);
        boolean changed = !Js.eqStr(draft.get("contextVersion"), p.contextVersion);
        ObjectNode value = ((ObjectNode) draft).deepCopy();
        value.put("requiresRefresh", changed);
        if (changed) {
            var invalidations = F.arrayNode();
            for (JsonNode i : draft.get("invalidations")) invalidations.add(i);
            for (String extra : List.of("context", "selection", "quote", "eligible-stock")) {
                if (!Js.includes(invalidations, extra)) invalidations.add(extra);
            }
            value.set("invalidations", invalidations);
            value.putNull("selection");
            value.putNull("quote");
            value.set("view", ManualDraftRules.view("context-changed", false, "refresh-review"));
        }
        return AccountOutcome.ok(value);
    }

    public AccountOutcome save(AccountScope identity, String subject, JsonNode input) {
        if (!ManualDraftRules.only(input, SAVE_KEYS) || !Js.text(input.get("commandId"))
                || input.get("commandId").textValue().length() > 128 || !ManualDraftRules.revision(input.get("expectedDraftVersion"))
                || !Js.text(input.get("expectedContextVersion"))) {
            return AccountOutcome.refused(ManualDraftRules.invalid("command",
                    "Supply a command ID, expected draft and context versions."));
        }
        String commandId = "manual:" + input.get("commandId").textValue();
        String digest = Canonical.digest(input);
        AccountOutcome replay = replay(identity, subject, commandId, digest);
        if (replay != null) return replay;
        Prepared p = accounts.prepare(identity);
        AtomicReference<AccountOutcome> refusal = new AtomicReference<>();
        return execute(identity, subject, new Command("manual-draft.save", commandId, input), input, refusal, tx -> {
            if (p.error != null) return refuse(refusal, p.error);
            if (!"ready".equals(p.state)) return refuse(refusal, conflict(p.state, AccountService.presentation(p.state)));
            AccountScope ctx = p.scope;
            if (occupied(tx, ctx)) return refuse(refusal, releaseRequired());
            if (!Js.eqStr(input.get("expectedContextVersion"), p.contextVersion)) {
                return refuse(refusal, stale("manual-context", input.get("expectedContextVersion"), F.textNode(p.contextVersion)));
            }
            ManualDraftRules.Validated validated = ManualDraftRules.validate(ctx, input.get("choices"), p);
            if (validated.invalid() != null) return refuse(refusal, AccountOutcome.refused(validated.invalid()));
            JsonNode employee = p.account.get("repositoryVersion");
            if (employee != null && !employee.isNull()) {
                Long current = version(tx, "SELECT version FROM employee_account_records WHERE environment_id = ? AND run_id = ? "
                        + "AND employee_id = ? FOR SHARE", ctx.environmentId(), ctx.runId(), ctx.employeeId());
                if (current != null && !same(employee, current)) {
                    return refuse(refusal, stale("employee-context", employee, F.numberNode(current)));
                }
            }
            JsonNode slotVersion = p.slot.get("version");
            if (slotVersion != null && !slotVersion.isNull()) {
                Long current = version(tx, "SELECT version FROM entitlement_slots WHERE environment_id = ? AND run_id = ? "
                        + "AND slot_id = ? FOR SHARE", ctx.environmentId(), ctx.runId(), ctx.entitlementSlotId());
                if (current != null && !same(slotVersion, current)) {
                    return refuse(refusal, stale("entitlement-slot", slotVersion, F.numberNode(current)));
                }
            }
            JsonNode last = tx.first(LATEST_SQL, ManualDrafts::parse, ctx.environmentId(), ctx.runId(), ctx.employeeId())
                    .orElse(null);
            long version = last == null ? 0 : last.get("draftVersion").longValue();
            JsonNode previous = last == null || Js.eqBool(last.get("discarded")) ? null : last;
            if (!same(input.get("expectedDraftVersion"), version)) {
                return refuse(refusal, stale(RESOURCE, input.get("expectedDraftVersion"), F.numberNode(version)));
            }
            ObjectNode value = ManualDraftRules.nextValue(ctx, subject, p, input.get("choices"), validated, previous, version);
            insert(tx, ctx, value, false, commandId);
            return WorkResult.ok(envelope(value));
        });
    }

    public AccountOutcome discard(AccountScope identity, String subject, JsonNode input) {
        if (!ManualDraftRules.only(input, DISCARD_KEYS) || !Js.text(input.get("commandId"))
                || input.get("commandId").textValue().length() > 128
                || !ManualDraftRules.revision(input.get("expectedDraftVersion"))) {
            return AccountOutcome.refused(ManualDraftRules.invalid("command",
                    "Supply a command ID and the expected draft version."));
        }
        String commandId = "manual:" + input.get("commandId").textValue();
        String digest = Canonical.digest(input);
        AccountOutcome replay = replay(identity, subject, commandId, digest);
        if (replay != null) return replay;
        String now = accounts.now(identity);
        if (now == null) return AccountOutcome.unavailable("clock");
        AccountService.Membership member = accounts.membership(identity);
        if (member.error() != null) return member.error();
        // No employment record means no draft and no hold can exist.
        if (member.scope() == null) return AccountOutcome.notFound(RESOURCE);
        AccountScope ctx = member.scope();
        AtomicReference<AccountOutcome> refusal = new AtomicReference<>();
        return execute(identity, subject, new Command("manual-draft.discard", commandId, input), input, refusal, tx -> {
            if (occupied(tx, ctx)) return refuse(refusal, releaseRequired());
            JsonNode last = tx.first(LATEST_SQL, ManualDrafts::parse, ctx.environmentId(), ctx.runId(), ctx.employeeId())
                    .orElse(null);
            if (last == null || Js.eqBool(last.get("discarded"))) return refuse(refusal, AccountOutcome.notFound(RESOURCE));
            long version = last.get("draftVersion").longValue();
            if (!same(input.get("expectedDraftVersion"), version)) {
                return refuse(refusal, stale(RESOURCE, input.get("expectedDraftVersion"), F.numberNode(version)));
            }
            ObjectNode value = F.objectNode();
            value.put("schemaVersion", 1).put("runId", ctx.runId()).put("employeeId", ctx.employeeId());
            value.put("draftVersion", version + 1).put("previousDraftVersion", version);
            value.put("entitlementSlotId", ctx.entitlementSlotId()).put("discarded", true);
            value.put("discardedAt", now).put("discardedBy", subject);
            insert(tx, ctx, value, true, commandId);
            return WorkResult.ok(envelope(value));
        });
    }

    /** Runs the command; a refusal rolls the transaction back and is answered with its own body, never stored. */
    private AccountOutcome execute(AccountScope identity, String subject, Command command, JsonNode input,
            AtomicReference<AccountOutcome> refusal, Work work) {
        RunContext run = new RunContext(identity.environmentId(), identity.runId(), subject);
        Outcome outcome = runner.execute(run, command, work);
        if (outcome instanceof Outcome.Committed c) return AccountOutcome.ok(c.result().get("value"));
        if (outcome instanceof Outcome.Refused && refusal.get() != null) return refusal.get();
        if (outcome instanceof Outcome.Conflict c) {
            if ("command-input-changed".equals(c.code())) return inputChanged();
            if ("stale-run".equals(c.code())) {
                return AccountOutcome.refused(F.objectNode().put("status", "stale-run").put("code", "stale-run")
                        .put("reason", "Your session belongs to an earlier run. Sign in again.").put("retryable", false));
            }
            if ("duplicate-record".equals(c.code())) return staleAfterRace(identity, input);
        }
        return AccountOutcome.unavailable(PORTS);
    }

    /** Two saves raced for the same next version: the loser reads what won. */
    private AccountOutcome staleAfterRace(AccountScope identity, JsonNode input) {
        try (Connection c = dataSource.getConnection()) {
            JsonNode last = latest(c, identity.environmentId(), identity.runId(), identity.employeeId());
            return stale(RESOURCE, input.get("expectedDraftVersion"), F.numberNode(last == null ? 0 : last.get("draftVersion").longValue()));
        } catch (SQLException | IOException e) {
            return AccountOutcome.unavailable(PORTS);
        }
    }

    /** A committed receipt answers before any mutable source can reject an identical retry; null when none exists. */
    private AccountOutcome replay(AccountScope identity, String subject, String commandId, String digest) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(RECEIPT_SQL)) {
            ps.setString(1, identity.environmentId());
            ps.setString(2, identity.runId());
            ps.setString(3, subject);
            ps.setString(4, commandId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                if (!rs.getString(1).equals(digest)) return inputChanged();
                return AccountOutcome.ok(JSON.readTree(rs.getString(2)).get("value"));
            }
        } catch (SQLException | IOException e) {
            return AccountOutcome.unavailable(PORTS);
        }
    }

    private static AccountOutcome inputChanged() {
        ObjectNode body = F.objectNode().put("status", "conflict").put("reason", "idempotency-input-changed");
        body.putObject("current");
        return AccountOutcome.refused(body);
    }

    private static AccountOutcome conflict(String reason, ObjectNode view) {
        ObjectNode body = F.objectNode().put("status", "conflict").put("reason", reason);
        body.set("view", view);
        return AccountOutcome.refused(body);
    }

    private static AccountOutcome releaseRequired() {
        return conflict("release-required", ManualDraftRules.view("conflict", false, "release-before-change"));
    }

    private static AccountOutcome stale(String resource, JsonNode expected, JsonNode current) {
        ObjectNode body = F.objectNode().put("status", "stale-version").put("resource", resource);
        body.set("expectedVersion", expected);
        body.set("currentVersion", current);
        body.put("action", "refresh");
        body.set("view", ManualDraftRules.view("conflict", false, "refresh-review"));
        return AccountOutcome.refused(body);
    }

    private static WorkResult refuse(AtomicReference<AccountOutcome> refusal, AccountOutcome outcome) {
        refusal.set(outcome);
        return WorkResult.refuse("manual-draft-refused", "The manual draft change was refused");
    }

    /** The value as it will read back from JSON, so a first answer equals its replay. */
    private static ObjectNode envelope(ObjectNode value) throws IOException {
        ObjectNode body = F.objectNode().put("status", "ok");
        body.set("value", JSON.readTree(value.toString()));
        return body;
    }

    private static boolean occupied(Tx tx, AccountScope ctx) throws SQLException {
        return tx.first(HOLD_SQL, rs -> Boolean.TRUE, ctx.environmentId(), ctx.runId(), ctx.employeeId(),
                ctx.entitlementSlotId()).isPresent();
    }

    private static Long version(Tx tx, String sql, Object... params) throws SQLException {
        return tx.first(sql, rs -> rs.getLong(1), params).orElse(null);
    }

    private static boolean same(JsonNode expected, long actual) {
        return expected != null && expected.isNumber() && expected.decimalValue().compareTo(BigDecimal.valueOf(actual)) == 0;
    }

    private static void insert(Tx tx, AccountScope ctx, ObjectNode value, boolean discarded, String commandId)
            throws SQLException {
        tx.write("INSERT INTO manual_drafts (environment_id, run_id, employee_id, draft_version, value, discarded, command_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)", ctx.environmentId(), ctx.runId(), ctx.employeeId(),
                value.get("draftVersion").longValue(), value, discarded, commandId);
    }

    private static JsonNode latest(Connection c, String env, String run, String employee) throws SQLException, IOException {
        try (PreparedStatement ps = c.prepareStatement(LATEST_SQL)) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setString(3, employee);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? JSON.readTree(rs.getString(1)) : null;
            }
        }
    }

    private static JsonNode parse(ResultSet rs) throws SQLException {
        try {
            return JSON.readTree(rs.getString(1));
        } catch (IOException e) {
            throw new SQLException("Stored draft is unreadable");
        }
    }
}
