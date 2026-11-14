package gcsp.api.cases;

import static gcsp.api.cases.CaseJson.date;
import static gcsp.api.cases.CaseJson.instant;
import static gcsp.api.cases.CaseJson.iso;
import static gcsp.api.cases.CaseJson.only;
import static gcsp.api.cases.CaseJson.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.cases.CaseResult.Refusal;
import gcsp.api.cases.CaseResult.Refused;
import gcsp.api.cases.CaseStore.History;
import gcsp.api.cases.CaseStore.Row;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Owned renewal cases: reads by key and commands that each run as one TransactionRunner command (receipt replay,
 * row lock, version CAS, outbox). A plain class so it runs without Quarkus; the HTTP slice wires it and checks roles.
 */
public final class CaseService {

    static final String DEFAULT_ACTION = "Scheme team to review your renewal and contact you.";
    private static final Map<String, List<String>> TRANSITIONS = Map.of("open", List.of("in-progress", "closed"),
            "in-progress", List.of("remedy-proposed", "resolved", "closed"),
            "remedy-proposed", List.of("in-progress", "resolved", "closed"), "resolved", List.of("closed"), "closed", List.of());
    private static final String NOT_CONNECTED =
            "Checking available cars for suitability is not connected yet, so none can be proposed.";

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final CasePolicyPort policy;
    private final CaseAccountPort account;
    private final CaseNotificationPort notifications;
    private final CaseCarSuitabilityPort suitability;
    private final Clock clock;

    public CaseService(DataSource dataSource, CasePolicyPort policy, CaseAccountPort account,
            CaseNotificationPort notifications, CaseCarSuitabilityPort suitability, Clock clock) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.policy = policy;
        this.account = account;
        this.notifications = notifications;
        this.suitability = suitability;
        this.clock = clock;
    }

    // ---- reads ----

    /** What asking for help does, before anything is written. */
    public CaseResult readHelp(EmployeeScope scope) {
        Optional<CasePolicy> rules = CasePolicy.load(policy, scope.policyVersion());
        if (rules.isEmpty()) return Refusal.unavailable();
        ObjectNode out = CaseJson.obj();
        out.put("opensCase", false).put("ownerRole", rules.get().ownerRole());
        out.put("extensionPermitted", rules.get().extensionPermitted());
        out.put("nextAction", "Ask for help to open an owned renewal case.").put("automaticRecoveryPriority", false);
        out.put("policyVersion", scope.policyVersion());
        out.set("assumptions", rules.get().assumptions());
        return new CaseResult.Ok(out);
    }

    /** The employee's own cases, or one of them; another employee's case is forbidden, an unknown one not found. */
    public CaseResult readOwn(EmployeeScope scope, Optional<String> caseId) {
        if (caseId.isPresent() && !text(caseId.get(), 128)) {
            return Refusal.invalid("caseId", "Use your current case reference.");
        }
        Optional<CasePolicy> rules = CasePolicy.load(policy, scope.policyVersion());
        if (rules.isEmpty()) return Refusal.unavailable();
        try (Snapshot snap = snapshot()) {
            Connection c = snap.connection;
            ObjectNode out = CaseJson.obj();
            if (caseId.isPresent()) {
                Optional<Row> found = CaseStore.one(c, scope.environmentId(), scope.runId(), caseId.get());
                if (found.isEmpty()) return Refusal.notFound("No renewal case exists with that reference.");
                if (!found.get().employeeId().equals(scope.employeeId())) {
                    return Refusal.forbidden("not-resource-owner", "This renewal case belongs to another employee.");
                }
                out.set("case", caseJson(found.get(), scope.runId()));
            } else {
                ArrayNode cases = out.putArray("cases");
                for (Row r : CaseStore.read(c, scope.environmentId(), scope.runId(), scope.employeeId(), null)) {
                    cases.add(caseJson(r, scope.runId()));
                }
            }
            out.put("asOf", iso(now())).put("policyVersion", scope.policyVersion());
            return new CaseResult.Ok(out);
        } catch (SQLException e) {
            return Refusal.unavailable();
        }
    }

    /** Every case of the run with history and the employee's name (the id when no name is known). */
    public CaseResult list(GregScope scope) {
        if (CasePolicy.load(policy, scope.policyVersion()).isEmpty()) return Refusal.unavailable();
        try (Snapshot snap = snapshot()) {
            Connection c = snap.connection;
            List<Row> rows = CaseStore.read(c, scope.environmentId(), scope.runId(), null, null);
            Map<String, String> names = new LinkedHashMap<>();
            for (Row r : rows) {
                names.computeIfAbsent(r.employeeId(), id -> {
                    CaseAccountPort.Lookup l = account.renewal(scope.environmentId(), scope.runId(), id);
                    return l.ok() && l.name() != null ? l.name() : id;
                });
            }
            ArrayNode cases = CaseJson.arr();
            for (Row r : rows) cases.add(withName(caseJson(r, scope.runId()), names.get(r.employeeId())));
            ObjectNode out = CaseJson.obj();
            out.set("cases", cases);
            out.put("asOf", iso(now())).put("policyVersion", scope.policyVersion());
            return new CaseResult.Ok(out);
        } catch (SQLException e) {
            return Refusal.unavailable();
        }
    }

    /** The remedies the scheme team can offer for one case, as they stand now. */
    public CaseResult readOptions(GregScope scope, String caseId) {
        if (!text(caseId, 128)) {
            return Refusal.invalid("caseId", "Choose a current renewal case.");
        }
        Optional<CasePolicy> rules = CasePolicy.load(policy, scope.policyVersion());
        if (rules.isEmpty()) return Refusal.unavailable();
        Row row;
        try (Snapshot snap = snapshot()) {
            Connection c = snap.connection;
            Optional<Row> found = CaseStore.one(c, scope.environmentId(), scope.runId(), caseId);
            if (found.isEmpty()) return Refusal.notFound("No renewal case exists with that reference.");
            row = found.get();
        } catch (SQLException e) {
            return Refusal.unavailable();
        }
        CaseAccountPort.Lookup renewal = account.renewal(scope.environmentId(), scope.runId(), row.employeeId());
        Refusal refusal = renewalRefusal(renewal, row);
        if (refusal != null) return refusal;
        Instant now = now();
        CaseCarSuitabilityPort.Options cars = suitability.options(scope.environmentId(), scope.runId(), row.employeeId());
        ObjectNode options = CaseJson.obj();
        options.set("alternativeCars", carOptions(cars));
        options.set("preferenceRelaxations", available(CaseJson.arr(),
                "A current confirmed brief and an unused recorded decline are required."));
        options.set("laterRelease", available(laterReleases(row, now),
                "No reviewed future release date and source are recorded for this case."));
        options.putObject("manualDecision").put("available", true).put("type", "manual-decision").put("requiresDecision", true);
        LocalDate end = date(renewal.contractEndDate());
        boolean permitted = rules.get().extensionPermitted();
        ObjectNode extension = options.putObject("contractExtension");
        extension.put("available", permitted && end != null).put("type", "contract-extension");
        if (end == null) extension.putNull("contractEndDate");
        else extension.put("contractEndDate", end.toString());
        extension.put("requiresUntil", true);
        if (!permitted) extension.put("reason", "The current policy does not permit a contract extension.");
        else if (end == null) extension.put("reason", "The actual contract end date needs confirmation.");
        ObjectNode out = CaseJson.obj();
        out.set("case", withName(caseJson(row, scope.runId()), renewal.name() != null ? renewal.name() : row.employeeId()));
        ArrayNode next = out.putArray("nextStatuses");
        TRANSITIONS.getOrDefault(row.status(), List.of()).forEach(next::add);
        out.put("asOf", iso(now)).put("policyVersion", scope.policyVersion()).put("automaticRecoveryPriority", false);
        out.set("options", options);
        return new CaseResult.Ok(out);
    }

    // ---- commands ----

    /** Opens the employee's owned case for the current renewal, or adds the request to the active one. */
    public CaseResult requestHelp(EmployeeScope scope, JsonNode input) {
        if (!only(input, "commandId", "reason") || !text(input.get("commandId"), 128) || !text(input.get("reason"), 2000)) {
            return Refusal.invalid("reason", "Describe the renewal problem and supply a command ID.");
        }
        Optional<CasePolicy> rules = CasePolicy.load(policy, scope.policyVersion());
        if (rules.isEmpty()) return Refusal.unavailable();
        CaseAccountPort.Lookup renewal = account.renewal(scope.environmentId(), scope.runId(), scope.employeeId());
        if (!renewal.ok()) return Refusal.unavailable();
        if (!text(renewal.renewalId(), 128)) {
            return missingRenewal();
        }
        Instant now = now();
        String commandId = input.get("commandId").textValue();
        String reason = input.get("reason").textValue();
        String renewalId = renewal.renewalId();
        LocalDate end = date(renewal.contractEndDate());
        CasePolicy rule = rules.get();
        return command(scope.runContext(), "case.request", commandId, input, null, tx -> {
            ObjectNode trigger = CaseJson.obj().put("type", "employee-request").put("requestId", commandId);
            Optional<Row> active = CaseStore.lockActive(tx, scope.employeeId(), renewalId);
            String caseId;
            if (active.isEmpty()) {
                caseId = "renewal-" + Canonical.digest(CaseJson.arr().add(scope.employeeId()).add(renewalId).add(trigger))
                        .substring(0, 40);
                Row fresh = new Row(caseId, scope.employeeId(), renewalId, "open", rule.ownerRole(), "Scheme team", reason,
                        trigger, DEFAULT_ACTION, now.plus(rule.dueHours(), ChronoUnit.HOURS), now, now, end,
                        end == null ? "needs-confirmation" : "supplied-demo-fact", scope.policyVersion(), null, 1, List.of());
                if (CaseStore.insert(tx, fresh)) {
                    CaseStore.appendHistory(tx, caseId, new History(now, scope.principalId(), "employee", "open", reason,
                            trigger, DEFAULT_ACTION, fresh.dueAt(), null));
                    return finish(tx, caseId);
                }
                // A concurrent request opened the case first; fall back to appending to it.
                active = CaseStore.lockActive(tx, scope.employeeId(), renewalId);
                if (active.isEmpty()) throw new TxConflict("duplicate-record", "A record with this identity already exists");
            }
            Row current = active.get();
            CaseStore.appendHistory(tx, current.caseId(), new History(now, scope.principalId(), "employee", current.status(),
                    reason, trigger, current.nextAction(), current.dueAt(), null));
            CaseStore.casTouch(tx, current.caseId(), current.version(), now);
            return finish(tx, current.caseId());
        });
    }

    /** The scheme team moves a case on: status, reason, next action, due date and (when needed) a remedy. */
    public CaseResult update(GregScope scope, JsonNode input) {
        if (!only(input, "commandId", "caseId", "expectedVersion", "status", "reason", "nextAction", "dueAt", "remedy")
                || !text(input.get("commandId"), 128) || !text(input.get("caseId"), 128)
                || !CaseJson.integer(input.get("expectedVersion")) || input.get("expectedVersion").doubleValue() < 1
                || !text(input.get("reason"), 2000) || !text(input.get("nextAction"), 2000) || instant(input.get("dueAt")) == null) {
            return Refusal.invalid("update", "Supply the current version, status, reason, next action and due date.");
        }
        Optional<CasePolicy> rules = CasePolicy.load(policy, scope.policyVersion());
        if (rules.isEmpty()) return Refusal.unavailable();
        Instant now = now();
        Instant dueAt = instant(input.get("dueAt"));
        if (!dueAt.isAfter(now)) return Refusal.invalid("dueAt", "Choose a future due time.");
        String caseId = input.get("caseId").textValue();
        long expected = input.get("expectedVersion").longValue();
        Row existing;
        try (Snapshot snap = snapshot()) {
            Connection c = snap.connection;
            Optional<Row> found = CaseStore.one(c, scope.environmentId(), scope.runId(), caseId);
            if (found.isEmpty()) return Refusal.notFound("No renewal case exists with that reference.");
            existing = found.get();
        } catch (SQLException e) {
            return Refusal.unavailable();
        }
        CaseAccountPort.Lookup renewal = account.renewal(scope.environmentId(), scope.runId(), existing.employeeId());
        String status = input.path("status").isTextual() ? input.get("status").textValue() : "";
        CasePolicy rule = rules.get();
        return command(scope.runContext(), "case.update", input.get("commandId").textValue(), input, expected, tx -> {
            Row c = CaseStore.lock(tx, caseId).orElseThrow(() -> new Refused(Refusal.notFound("No renewal case exists with that reference.")));
            if (c.version() != expected) throw new Refused(Refusal.staleVersion(expected, c.version()));
            if (!TRANSITIONS.getOrDefault(c.status(), List.of()).contains(status)) {
                throw new Refused(Refusal.invalid("status", "Choose the next permitted case status."));
            }
            Refusal refusal = renewalRefusal(renewal, c);
            if (refusal != null) throw new Refused(refusal);
            ObjectNode remedy = c.remedy();
            boolean needed = List.of("remedy-proposed", "resolved").contains(status);
            if (input.has("remedy") || needed) {
                JsonNode submitted = input.has("remedy") ? input.get("remedy") : c.remedy();
                if (!input.has("remedy") && submitted != null && "alternative-car".equals(submitted.path("type").asText())) {
                    submitted = CaseJson.obj().put("type", "alternative-car").set("orderUuid", submitted.get("orderUuid"));
                }
                remedy = checkRemedy(scope, c, renewal, rule, now, submitted);
            }
            CaseStore.appendHistory(tx, c.caseId(), new History(now, scope.principalId(), rule.ownerRole(), status,
                    input.get("reason").textValue(), null, input.get("nextAction").textValue(), dueAt, remedy));
            CaseStore.casUpdate(tx, c.caseId(), c.version(), status, input.get("nextAction").textValue(), dueAt, remedy, now);
            return finish(tx, c.caseId());
        });
    }

    // ---- remedies ----

    private ObjectNode checkRemedy(GregScope scope, Row c, CaseAccountPort.Lookup renewal, CasePolicy rule, Instant now,
            JsonNode remedy) {
        if (!CaseJson.object(remedy) || !text(remedy.get("type"), 128)) {
            throw new Refused(Refusal.invalid("remedy", "The scheme team must record a remedy before resolving this case."));
        }
        switch (remedy.get("type").textValue()) {
            case "manual-decision":
                if (!only(remedy, "type", "decision") || !text(remedy.get("decision"), 2000)) {
                    throw new Refused(Refusal.invalid("remedy.decision", "Record the authorised scheme-team decision."));
                }
                return (ObjectNode) remedy.deepCopy();
            case "contract-extension": {
                if (!rule.extensionPermitted()) {
                    throw new Refused(Refusal.forbidden("forbidden", "The scheme does not permit a contract extension under this policy."));
                }
                LocalDate until = remedy.path("until").isTextual() ? date(remedy.get("until").textValue()) : null;
                LocalDate end = date(renewal.contractEndDate());
                boolean valid = only(remedy, "type", "until") && until != null && end != null && until.isAfter(end)
                        && until.atTime(23, 59, 59, 999_000_000).toInstant(java.time.ZoneOffset.UTC).isAfter(now);
                if (!valid) {
                    throw new Refused(Refusal.invalid("remedy.until", "Supply a permitted extension date after the actual contract end."));
                }
                return (ObjectNode) remedy.deepCopy();
            }
            case "later-release": {
                if (!validLater(remedy, now)) {
                    throw new Refused(Refusal.invalid("remedy.releaseAt",
                            "Supply a realistic future release date and the reviewed plan it came from."));
                }
                return (ObjectNode) remedy.deepCopy();
            }
            case "preference-relaxation":
                throw new Refused(Refusal.forbidden("forbidden", "A recorded decline for this employee is required."));
            case "alternative-car": {
                if (!only(remedy, "type", "orderUuid") || !text(remedy.get("orderUuid"), 128)) {
                    throw new Refused(Refusal.invalid("remedy.orderUuid", "Choose a current suitable available car."));
                }
                CaseCarSuitabilityPort.Check check = suitability.check(scope.environmentId(), scope.runId(), c.employeeId(),
                        remedy.get("orderUuid").textValue());
                if (check.verdict() == CaseCarSuitabilityPort.Verdict.UNAVAILABLE) throw new Refused(Refusal.unavailable());
                if (check.verdict() == CaseCarSuitabilityPort.Verdict.UNSUITABLE || check.remedy() == null) {
                    throw new Refused(Refusal.invalid("remedy.orderUuid",
                            "This car does not satisfy the current eligibility, essential, points and timing constraints."));
                }
                return check.remedy();
            }
            default:
                throw new Refused(Refusal.invalid("remedy.type", "Choose a supported scheme-team remedy."));
        }
    }

    private static boolean validLater(JsonNode remedy, Instant now) {
        Instant release = instant(remedy.get("releaseAt"));
        return only(remedy, "type", "releaseAt", "source") && release != null && release.isAfter(now)
                && text(remedy.get("source"), 2000);
    }

    private ArrayNode laterReleases(Row row, Instant now) {
        ArrayNode items = CaseJson.arr();
        List<ObjectNode> all = new ArrayList<>();
        all.add(row.remedy());
        row.history().forEach(h -> all.add(h.remedy()));
        for (ObjectNode r : all) {
            if (r == null || !"later-release".equals(r.path("type").asText()) || !validLater(r, now)) continue;
            boolean seen = false;
            for (JsonNode i : items) seen |= i.equals(r);
            if (!seen) items.add(r.deepCopy());
        }
        return items;
    }

    private static ObjectNode carOptions(CaseCarSuitabilityPort.Options cars) {
        ObjectNode n = CaseJson.obj();
        ArrayNode items = CaseJson.arr();
        cars.items().forEach(items::add);
        ArrayNode unconfirmed = CaseJson.arr();
        cars.needsConfirmation().forEach(unconfirmed::add);
        n.put("available", !items.isEmpty());
        n.set("items", items);
        n.set("needsConfirmation", unconfirmed);
        if (!cars.connected()) n.put("reason", NOT_CONNECTED);
        else if (items.isEmpty()) {
            n.put("reason", unconfirmed.isEmpty() ? "No suitable available car is currently recorded."
                    : "No available car is confirmed as suitable yet. The cars listed need confirmation first.");
        }
        return n;
    }

    private static ObjectNode available(ArrayNode items, String reason) {
        ObjectNode n = CaseJson.obj();
        n.put("available", !items.isEmpty());
        n.set("items", items);
        if (items.isEmpty()) n.put("reason", reason);
        return n;
    }

    // ---- command plumbing ----

    @FunctionalInterface
    private interface Body {
        ObjectNode run(Tx tx) throws SQLException;
    }

    private CaseResult command(RunContext ctx, String type, String commandId, JsonNode input, Long expected, Body body) {
        ObjectNode digestInput = CaseJson.obj();
        digestInput.put("operation", type);
        digestInput.set("input", input);
        try {
            Outcome outcome = runner.execute(ctx, new Command(type, commandId, digestInput),
                    tx -> WorkResult.ok(body.run(tx)));
            return map(outcome, ctx, expected, input);
        } catch (Refused r) {
            return r.refusal();
        }
    }

    /** Re-reads the case on the command's connection, queues its notification and returns the command result. */
    private ObjectNode finish(Tx tx, String caseId) throws SQLException {
        Row stored = CaseStore.one(tx.connection(), tx.context().environmentId(), tx.context().runId(), caseId)
                .orElseThrow(() -> new SQLException("Case " + caseId + " is missing"));
        notifications.caseUpdated(tx, caseUpdate(stored, tx.context().runId()));
        ObjectNode out = CaseJson.obj();
        out.set("case", caseJson(stored, tx.context().runId()));
        return out;
    }

    private CaseResult map(Outcome outcome, RunContext ctx, Long expected, JsonNode input) {
        if (outcome instanceof Outcome.Committed c) return new CaseResult.Ok(c.result(), c.replayed());
        if (outcome instanceof Outcome.Uncertain u) {
            ObjectNode extra = CaseJson.obj().put("operationId", u.operationId());
            return new Refusal(503, "unavailable", "outcome-uncertain",
                    "The case change may or may not have completed. Check before trying again.", false, extra);
        }
        if (outcome instanceof Outcome.Unavailable) return Refusal.unavailable();
        if (outcome instanceof Outcome.Refused r) return Refusal.invalid(r.code(), "command", r.message());
        Outcome.Conflict k = (Outcome.Conflict) outcome;
        if ("stale-version".equals(k.code()) && expected != null) {
            try (Snapshot snap = snapshot()) {
            Connection c = snap.connection;
                Optional<Row> now = CaseStore.one(c, ctx.environmentId(), ctx.runId(), input.path("caseId").asText());
                return Refusal.staleVersion(expected, now.map(Row::version).orElse(0L));
            } catch (SQLException e) {
                return Refusal.unavailable();
            }
        }
        return Refusal.conflict(k.code(), k.message());
    }

    private static Refusal missingRenewal() {
        return Refusal.invalid("renewal-context-required", "renewalId",
                "The actual renewal has not been supplied. Ask the scheme team to check your contract.");
    }

    /** Unavailable, missing or changed renewal context for this case, or null when it still matches. */
    private static Refusal renewalRefusal(CaseAccountPort.Lookup renewal, Row c) {
        if (!renewal.ok()) return Refusal.unavailable();
        if (renewal.renewalId() == null) return missingRenewal();
        if (!renewal.renewalId().equals(c.renewalId())) {
            return Refusal.conflict("renewal-changed", "The current renewal differs from this case. Review the employee contract.");
        }
        return null;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MILLIS);
    }

    /** One consistent snapshot for a read that spans the cases and history queries; close restores the connection. */
    private Snapshot snapshot() throws SQLException {
        return new Snapshot(dataSource.getConnection());
    }

    private static final class Snapshot implements AutoCloseable {
        private final Connection connection;

        Snapshot(Connection connection) throws SQLException {
            this.connection = connection;
            try {
                connection.setAutoCommit(false);
                connection.setReadOnly(true);
                connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            } catch (SQLException | RuntimeException e) {
                close();
                throw e;
            }
        }

        @Override
        public void close() throws SQLException {
            try {
                connection.rollback();
                connection.setReadOnly(false);
                connection.setAutoCommit(true);
                connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            } finally {
                connection.close();
            }
        }
    }

    // ---- projections ----

    static ObjectNode caseJson(Row r, String runId) {
        ObjectNode n = CaseJson.obj();
        n.put("caseId", r.caseId()).put("runId", runId).put("employeeId", r.employeeId()).put("renewalId", r.renewalId());
        n.putObject("owner").put("role", r.ownerRole()).put("name", r.ownerName());
        n.put("status", r.status()).put("reason", r.reason());
        n.set("trigger", r.trigger());
        n.put("nextAction", r.nextAction()).put("dueAt", iso(r.dueAt())).put("openedAt", iso(r.openedAt()));
        n.put("lastUpdatedAt", iso(r.lastUpdatedAt()));
        if (r.renewalDeadline() == null) n.putNull("renewalDeadline");
        else n.put("renewalDeadline", r.renewalDeadline().toString());
        n.put("renewalDeadlineState", r.renewalDeadlineState()).put("policyVersion", r.policyVersion());
        ArrayNode history = n.putArray("history");
        for (History h : r.history()) {
            ObjectNode e = history.addObject();
            e.put("at", iso(h.at())).put("actorId", h.actorId()).put("actorRole", h.actorRole());
            e.put("status", h.status()).put("reason", h.reason());
            if (h.trigger() != null) e.set("trigger", h.trigger());
            e.put("nextAction", h.nextAction()).put("dueAt", iso(h.dueAt()));
            if (h.remedy() == null) e.putNull("remedy");
            else e.set("remedy", h.remedy());
        }
        if (r.remedy() == null) n.putNull("remedy");
        else n.set("remedy", r.remedy());
        n.put("fictional", true).put("version", r.version());
        return n;
    }

    private static ObjectNode withName(ObjectNode c, String name) {
        c.put("employeeName", name);
        return c;
    }

    private static ObjectNode caseUpdate(Row r, String runId) {
        History last = r.history().get(r.history().size() - 1);
        ObjectNode n = CaseJson.obj();
        n.put("caseId", r.caseId()).put("runId", runId).put("employeeId", r.employeeId()).put("renewalId", r.renewalId());
        n.put("caseVersion", r.version()).put("status", r.status());
        n.putObject("owner").put("role", r.ownerRole()).put("name", r.ownerName());
        n.put("nextAction", r.nextAction()).put("dueAt", iso(r.dueAt())).put("reason", last.reason());
        n.put("occurredAt", iso(last.at()));
        if (r.remedy() == null) n.putNull("remedy");
        else n.set("remedy", r.remedy());
        n.put("fictional", true);
        return n;
    }
}
