package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * The employee's order review details for their manual claim, a port of server/gcsp/manual-review. Each save is one
 * immutable manual_review_details row; a freeze (ordering's backend call) is one manual_review_freezes row per hold.
 */
public final class ManualReviewDetails {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String RULES = "manual.context.v1";
    private static final List<String> KEYS = List.of("runId", "employeeId", "entitlementSlotId", "holdId", "quoteId",
            "expectedDraftVersion");

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final ClaimClock clock;
    private final ManualClaims claims;
    private final PolicyService policy;

    public ManualReviewDetails(DataSource dataSource, TransactionRunner runner, ClaimClock clock, ManualClaims claims,
            PolicyService policy) {
        this.dataSource = dataSource;
        this.runner = runner;
        this.clock = clock;
        this.claims = claims;
        this.policy = policy;
    }

    /** The trusted selection binding ordering holds when it freezes the details. */
    public record Binding(String runId, String employeeId, String entitlementSlotId, String holdId, String quoteId,
            long expectedHoldVersion, long expectedDraftVersion) {}

    /** What a caller wants checked: null fields are not checked (a read follows whatever the latest claim is). */
    private record Want(String slotId, String holdId, String quoteId, Long holdVersion, Long draftVersion) {}

    private record Snapshot(ObjectNode binding, ClaimRow row, ObjectNode hold, ObjectNode quote, String orderNumber,
            long stockVersion, ObjectNode draft, ObjectNode metadata, ObjectNode frozen, boolean pending, Instant now,
            long clockVersion) {

        String digest() {
            ObjectNode n = F.objectNode();
            n.set("binding", binding);
            n.set("hold", hold);
            n.set("quote", quote);
            n.put("orderNumber", orderNumber).put("stockVersion", stockVersion);
            n.set("draft", draft);
            n.set("metadata", metadata == null ? F.nullNode() : metadata);
            n.set("frozen", frozen == null ? F.nullNode() : frozen);
            n.put("pending", pending).put("now", PolicyClock.iso(now)).put("clockVersion", clockVersion);
            return Canonical.digest(n);
        }

        long revision() {
            return metadata == null ? 0 : metadata.get("reviewDetailsVersion").longValue();
        }

        boolean editable() {
            return "active".equals(row.state()) && frozen == null && !pending && now.isBefore(row.expiresAt())
                    && now.isBefore(row.validUntil());
        }

        boolean lockedState() {
            return "selection-pending".equals(row.state()) || "allocated".equals(row.state());
        }
    }

    private record Snapped(Snapshot value, ReviewResult refusal) {
        static Snapped refused(ReviewResult r) {
            return new Snapped(null, r);
        }
    }

    private record Limits(ReviewValidation.Constraints value, ReviewResult refusal) {}

    /** Thrown inside the save transaction to roll it back and answer with this result. */
    private static final class Refused extends RuntimeException {
        private final transient ReviewResult result;

        Refused(ReviewResult result) {
            super(result.code(), null, false, false);
            this.result = result;
        }
    }

    // ---- reads ----

    /** The details screen's data: the employee's own claim, the saved or initial details and the policy limits. */
    public ReviewResult read(ClaimScope scope) {
        try {
            ClaimResult claim = claims.readClaim(scope);
            if (!(claim instanceof ClaimResult.Ok ok)) return new ReviewResult.Claim(claim);
            if (!ok.value().path("hold").isObject() || !ok.value().path("quote").isObject()) {
                return ReviewResult.unavailable("claim");
            }
            Instant now = now(scope.context());
            if (now == null) return ReviewResult.unavailable("clock");
            Want want = new Want(null, ok.value().path("hold").path("holdId").asText(),
                    ok.value().path("quote").path("quoteId").asText(), null, null);
            Snapshot first;
            Limits limits;
            try (Connection c = dataSource.getConnection()) {
                Snapped a = snapshot(c, scope, want, now, false);
                if (a.refusal() != null) return a.refusal();
                first = a.value();
                limits = limits(first);
                if (limits.refusal() != null) return limits.refusal();
                // This read fence detects a save, freeze, hold change or clock tick while the projection was built.
                Snapped b = snapshot(c, scope, want, now, false);
                if (b.refusal() != null) return b.refusal();
                if (!first.digest().equals(b.value().digest())) return ReviewResult.conflict("review-read-changed");
            }
            return ReviewResult.ok(projection(first, limits.value()));
        } catch (SQLException | RuntimeException e) {
            return ReviewResult.unavailable("review-details");
        }
    }

    // ---- save ----

    /** Saves the next details version; a repeated command id answers from its receipt before any live check. */
    public ReviewResult save(ClaimScope scope, JsonNode input) {
        ReviewResult shape = ReviewValidation.validateCommand(input);
        if (shape != null) return shape;
        try {
            Command cmd = new Command("manual-review.save", "manual:review-details:" + scope.employeeId() + ":"
                    + input.get("commandId").textValue(), input);
            Inspection seen = runner.inspect(scope.context(), cmd.commandId());
            if (seen instanceof Inspection.Unavailable) return ReviewResult.unavailable("review-details");
            if (seen instanceof Inspection.Committed) return answer(runner.execute(scope.context(), cmd, tx -> {
                throw new IllegalStateException("a committed command id is answered from its receipt");
            }), scope, input);
            ClaimResult claim = claims.readClaim(scope);
            if (!(claim instanceof ClaimResult.Ok)) return new ReviewResult.Claim(claim);
            Instant now = now(scope.context());
            if (now == null) return ReviewResult.unavailable("clock");
            Want want = new Want(null, input.get("holdId").textValue(), input.get("quoteId").textValue(),
                    input.get("expectedHoldVersion").longValue(), input.get("expectedDraftVersion").longValue());
            Snapshot before;
            Limits limits;
            try (Connection c = dataSource.getConnection()) {
                Snapped a = snapshot(c, scope, want, now, false);
                if (a.refusal() != null) return a.refusal();
                before = a.value();
                limits = limits(before);
                if (limits.refusal() != null) return limits.refusal();
            }
            ReviewResult bad = ReviewValidation.validateDetails(input.get("details"),
                    before.draft().path("choices").path("mode").asText(), limits.value());
            if (bad != null) return bad;
            long expected = input.get("expectedReviewDetailsVersion").longValue();
            long clockBefore = before.clockVersion();
            ReviewValidation.Constraints constraints = limits.value();
            return answer(runner.execute(scope.context(), cmd, tx -> {
                Instant fresh = now(tx.context());
                if (fresh == null) throw new Refused(ReviewResult.unavailable("clock"));
                Snapped checked = snapshot(tx.connection(), scope, want, fresh, true);
                if (checked.refusal() != null) throw new Refused(checked.refusal());
                Snapshot s = checked.value();
                if (s.clockVersion() != clockBefore) throw new Refused(ReviewResult.stale("clock", clockBefore, s.clockVersion()));
                if (s.frozen() != null || s.pending() || s.lockedState()) throw new Refused(ReviewResult.conflict("review-details-locked"));
                if (!"active".equals(s.row().state())) throw new Refused(ReviewResult.conflict("claim-not-active"));
                if (!s.editable()) throw new Refused(ReviewResult.conflict("claim-expired"));
                if (s.revision() != expected) throw new Refused(ReviewResult.stale("review-details", expected, s.revision()));
                ObjectNode metadata = F.objectNode();
                metadata.set("binding", s.binding());
                metadata.put("reviewDetailsVersion", s.revision() + 1);
                metadata.set("details", ReviewValidation.safeDetails(input.get("details")));
                metadata.set("constraints", constraintsJson(constraints));
                metadata.put("savedAt", PolicyClock.iso(s.now())).put("clockVersion", Long.toString(s.clockVersion()));
                RunContext x = tx.context();
                tx.write("INSERT INTO manual_review_details (environment_id, run_id, employee_id, slot_id, hold_id, "
                        + "review_details_version, binding, details, constraints, saved_at, clock_version, command_id) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", x.environmentId(), x.runId(), scope.employeeId(),
                        s.row().slotId(), s.row().holdId(), s.revision() + 1, s.binding(), metadata.get("details"),
                        metadata.get("constraints"), s.now(), s.clockVersion(), cmd.commandId());
                Snapshot saved = new Snapshot(s.binding(), s.row(), s.hold(), s.quote(), s.orderNumber(), s.stockVersion(),
                        s.draft(), metadata, null, false, s.now(), s.clockVersion());
                return WorkResult.ok(JSON.readTree(projection(saved, constraints).toString()));
            }), scope, input);
        } catch (Refused r) {
            return r.result;
        } catch (SQLException | RuntimeException e) {
            return ReviewResult.unavailable("review-details");
        }
    }

    private ReviewResult answer(Outcome o, ClaimScope scope, JsonNode input) {
        if (o instanceof Outcome.Committed c) {
            return ReviewResult.ok(c.result());
        }
        if (o instanceof Outcome.Conflict c) {
            if ("command-input-changed".equals(c.code())) return ReviewResult.conflict("idempotency-input-changed");
            if ("stale-run".equals(c.code())) return ReviewResult.staleRun();
            if ("duplicate-record".equals(c.code())) return staleAfterRace(scope, input);
        }
        return ReviewResult.unavailable("review-details");
    }

    /** Two saves raced for the same next version: the loser reads what won. */
    private ReviewResult staleAfterRace(ClaimScope scope, JsonNode input) {
        try (Connection c = dataSource.getConnection()) {
            long current = Db.first(c, "SELECT max(review_details_version) FROM manual_review_details WHERE environment_id = ? "
                    + "AND run_id = ? AND employee_id = ? AND hold_id = ?", rs -> rs.getLong(1), scope.environmentId(),
                    scope.runId(), scope.employeeId(), input.get("holdId").textValue()).orElse(0L);
            return ReviewResult.stale("review-details", input.get("expectedReviewDetailsVersion").longValue(), current);
        } catch (SQLException e) {
            return ReviewResult.unavailable("review-details");
        }
    }

    // ---- freeze (ordering's backend call) ----

    /**
     * Inside the caller's transaction: pins the saved details so no later save can change them. The caller must roll
     * back on any refusal. Idempotent for the same binding and version. Not wired into ordering yet.
     */
    public ReviewResult freeze(Tx tx, Binding b, long expectedDetailsVersion) throws SQLException, IOException {
        if (b == null || !id(b.runId()) || !id(b.employeeId()) || !id(b.entitlementSlotId()) || !id(b.holdId())
                || !id(b.quoteId()) || b.expectedHoldVersion() <= 0 || b.expectedDraftVersion() <= 0
                || expectedDetailsVersion < 0) {
            return ReviewResult.invalid("binding", "Supply the complete trusted selection binding and revisions.");
        }
        RunContext x = tx.context();
        if (!x.runId().equals(b.runId())) return ReviewResult.staleRun();
        Instant now = now(x);
        if (now == null) return ReviewResult.unavailable("clock");
        ClaimScope scope = new ClaimScope(x.environmentId(), x.runId(), x.actorId(), b.employeeId(), null);
        Snapped checked = snapshot(tx.connection(), scope, new Want(b.entitlementSlotId(), b.holdId(), b.quoteId(),
                b.expectedHoldVersion(), b.expectedDraftVersion()), now, true);
        if (checked.refusal() != null) return checked.refusal();
        Snapshot s = checked.value();
        if (s.revision() != expectedDetailsVersion) return ReviewResult.stale("review-details", expectedDetailsVersion, s.revision());
        if (!now.isBefore(s.row().expiresAt()) || !now.isBefore(s.row().validUntil())) return ReviewResult.conflict("claim-expired");
        if (s.frozen() != null) {
            boolean same = Canonical.digest(s.frozen().get("binding")).equals(Canonical.digest(s.binding()))
                    && s.frozen().get("reviewDetailsVersion").longValue() == expectedDetailsVersion;
            return same ? ReviewResult.ok(s.frozen().deepCopy()) : ReviewResult.conflict("review-details-locked");
        }
        if (s.pending() || s.lockedState()) return ReviewResult.conflict("review-details-locked");
        if (!"active".equals(s.row().state())) return ReviewResult.conflict("claim-not-active");
        if (!s.editable()) return ReviewResult.conflict("claim-expired");
        if (s.metadata() == null) return ReviewResult.conflict("review-details-not-saved");
        ObjectNode frozen = s.metadata().deepCopy();
        frozen.set("binding", s.binding());
        frozen.put("frozenAt", PolicyClock.iso(s.now())).put("frozenClockVersion", Long.toString(s.clockVersion()));
        tx.write("INSERT INTO manual_review_freezes (environment_id, run_id, employee_id, slot_id, hold_id, "
                + "review_details_version, binding, snapshot, frozen_at, clock_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                x.environmentId(), x.runId(), b.employeeId(), b.entitlementSlotId(), b.holdId(), expectedDetailsVersion,
                s.binding(), frozen, s.now(), s.clockVersion());
        return ReviewResult.ok(JSON.readTree(frozen.toString()));
    }

    // ---- snapshot ----

    private Snapped snapshot(Connection c, ClaimScope scope, Want want, Instant now, boolean lock) throws SQLException {
        String env = scope.environmentId();
        String run = scope.runId();
        String employee = scope.employeeId();
        String status = Db.first(c, "SELECT status FROM runs WHERE environment_id = ? AND run_id = ?", rs -> rs.getString(1),
                env, run).orElse(null);
        if (!"active".equals(status)) return Snapped.refused(ReviewResult.staleRun());
        // The run clock row's version when the run has one; a run without a clock row reads as version 1.
        long clockVersion = Db.first(c, "SELECT clock_version FROM run_clocks WHERE environment_id = ? AND run_id = ?",
                rs -> rs.getLong(1), env, run).orElse(1L);
        if (Db.first(c, "SELECT 1 FROM employees WHERE environment_id = ? AND run_id = ? AND employee_id = ?", rs -> 1,
                env, run, employee).isEmpty()) {
            return Snapped.refused(ReviewResult.notFound("employee"));
        }
        ClaimRow row = ClaimRow.latest(c, env, run, employee).orElse(null);
        if (row == null) return Snapped.refused(ReviewResult.notFound("manual-claim"));
        if (want.holdId() != null && !want.holdId().equals(row.holdId())) return Snapped.refused(ReviewResult.conflict("claim-binding-changed"));
        if (lock) {
            row = ClaimRow.byHold(c, env, run, row.holdId(), true).orElse(null);
            if (row == null) return Snapped.refused(ReviewResult.notFound("manual-claim"));
        }
        if (!employee.equals(row.employeeId()) || !"cart".equals(row.holdType())) {
            return Snapped.refused(ReviewResult.forbidden("This claim belongs to another entitlement."));
        }
        if (want.slotId() != null && !want.slotId().equals(row.slotId())
                || Db.first(c, "SELECT 1 FROM entitlement_slots WHERE environment_id = ? AND run_id = ? AND slot_id = ? "
                + "AND employee_id = ?", rs -> 1, env, run, row.slotId(), employee).isEmpty()) {
            return Snapped.refused(ReviewResult.forbidden("This entitlement belongs to another employee."));
        }
        String quoteId = ManualClaims.quoteId(row.holdId());
        if (want.quoteId() != null && !want.quoteId().equals(quoteId)) return Snapped.refused(ReviewResult.conflict("quote-binding-changed"));
        ObjectNode quote = row.quoteView();
        if (!employee.equals(quote.path("employeeId").asText(null)) || !row.slotId().equals(quote.path("entitlementSlotId").asText(null))
                || !row.orderUuid().equals(quote.path("orderUuid").asText(null))
                || !row.policyVersion().equals(quote.path("policyVersion").asText(null))
                || !ReviewValidation.validInstant(quote.path("validUntil").asText(null)) || row.expiresAt() == null) {
            return Snapped.refused(ReviewResult.conflict("quote-binding-changed"));
        }
        JsonNode car = Db.first(c, "SELECT configuration_id, version, attributes::text FROM stock_cars WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ?", rs -> {
                    ObjectNode n = F.objectNode().put("configurationId", rs.getString(1)).put("version", rs.getLong(2));
                    n.set("attributes", json(rs.getString(3)));
                    return (JsonNode) n;
                }, env, run, row.orderUuid()).orElse(null);
        if (car == null) return Snapped.refused(ReviewResult.unavailable("stock"));
        String number = car.path("attributes").path("orderNumber").asText("");
        if (!car.path("configurationId").asText().equals(quote.path("configurationId").asText(null)) || !number.matches("[0-9]{7}")) {
            return Snapped.refused(ReviewResult.conflict("stock-binding-changed"));
        }
        if (want.holdVersion() != null && row.version() != want.holdVersion()) {
            return Snapped.refused(ReviewResult.stale("hold", want.holdVersion(), row.version()));
        }
        if (want.draftVersion() != null && row.draftVersion() != want.draftVersion()) {
            return Snapped.refused(ReviewResult.stale("manual-draft", want.draftVersion(), row.draftVersion()));
        }
        ObjectNode draft = pinnedDraft(c, scope, row, quote);
        if (draft == null) return Snapped.refused(ReviewResult.unavailable("pinned-draft"));
        ObjectNode binding = F.objectNode();
        binding.put("runId", run).put("employeeId", employee).put("entitlementSlotId", row.slotId());
        binding.put("holdId", row.holdId()).put("quoteId", quoteId);
        binding.put("expectedHoldVersion", row.version()).put("expectedDraftVersion", row.draftVersion());
        Found saved = metadata(c, scope, row, binding);
        if (saved.invalid()) return Snapped.refused(ReviewResult.unavailable("metadata"));
        Found freeze = frozen(c, scope, row, binding, saved.value());
        if (freeze.invalid()) return Snapped.refused(ReviewResult.unavailable("freeze"));
        ObjectNode metadata = saved.value();
        ObjectNode frozen = freeze.value();
        boolean pending = Db.first(c, "SELECT 1 FROM manual_claim_operations o JOIN pending_operations p ON "
                + "p.environment_id = o.environment_id AND p.run_id = o.run_id AND p.operation_id = o.operation_id "
                + "WHERE o.environment_id = ? AND o.run_id = ? AND o.hold_id = ? AND o.operation_type = 'manual-allocate' "
                + "AND p.state IN ('intent', 'pending') LIMIT 1", rs -> 1, env, run, row.holdId()).isPresent();
        ObjectNode hold = row.hold();
        hold.put("runId", run).put("quoteId", quoteId).put("policyVersion", row.policyVersion());
        quote.put("runId", run);
        return new Snapped(new Snapshot(binding, row, hold, quote, number, car.path("version").longValue(), draft, metadata,
                frozen, pending, now, clockVersion), null);
    }

    /** The complete draft version the quote pinned, for this run and employee; null when it is missing or unusable. */
    private static ObjectNode pinnedDraft(Connection c, ClaimScope scope, ClaimRow row, ObjectNode quote) throws SQLException {
        JsonNode d = Db.first(c, "SELECT value::text FROM manual_drafts WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ? AND draft_version = ?", rs -> json(rs.getString(1)), scope.environmentId(),
                scope.runId(), scope.employeeId(), row.draftVersion()).orElse(null);
        if (d == null || !d.isObject() || !scope.runId().equals(d.path("runId").asText(null))
                || !scope.employeeId().equals(d.path("employeeId").asText(null))
                || !row.slotId().equals(d.path("entitlementSlotId").asText(null))
                || !"complete".equals(d.path("draftStage").asText(null)) || d.path("draftVersion").asLong(-1) != row.draftVersion()
                || !row.policyVersion().equals(d.path("policyVersion").asText(null))
                || !List.of("replacement", "new").contains(d.path("choices").path("mode").asText(null))
                || !d.path("choices").path("contact").isObject()) {
            return null;
        }
        return (ObjectNode) d;
    }

    private record Found(ObjectNode value, boolean invalid) {}

    /** The latest saved version, absent when none; invalid when its stored binding is not this claim's. */
    private static Found metadata(Connection c, ClaimScope scope, ClaimRow row, ObjectNode binding) throws SQLException {
        Optional<ObjectNode> found = Db.first(c, "SELECT review_details_version, binding::text, details::text, constraints::text, "
                + "saved_at, clock_version FROM manual_review_details WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ? AND slot_id = ? AND hold_id = ? ORDER BY review_details_version DESC LIMIT 1", rs -> {
                    ObjectNode n = F.objectNode();
                    n.set("binding", json(rs.getString(2)));
                    n.put("reviewDetailsVersion", rs.getLong(1));
                    n.set("details", json(rs.getString(3)));
                    n.set("constraints", json(rs.getString(4)));
                    n.put("savedAt", PolicyClock.iso(Db.instant(rs, 5))).put("clockVersion", Long.toString(rs.getLong(6)));
                    return n;
                }, scope.environmentId(), scope.runId(), scope.employeeId(), row.slotId(), row.holdId());
        if (found.isEmpty()) return new Found(null, false);
        return new Found(found.get(), !sameBinding(found.get().get("binding"), binding));
    }

    /** The freeze row; invalid when it names another version than the latest save or another binding. */
    private static Found frozen(Connection c, ClaimScope scope, ClaimRow row, ObjectNode binding, ObjectNode metadata)
            throws SQLException {
        Optional<ObjectNode> found = Db.first(c, "SELECT snapshot::text FROM manual_review_freezes WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ? AND slot_id = ? AND hold_id = ?",
                rs -> (ObjectNode) json(rs.getString(1)), scope.environmentId(), scope.runId(), scope.employeeId(),
                row.slotId(), row.holdId());
        if (found.isEmpty()) return new Found(null, false);
        long version = metadata == null ? 0 : metadata.get("reviewDetailsVersion").longValue();
        boolean fine = found.get().path("reviewDetailsVersion").asLong(-1) == version
                && sameBinding(found.get().get("binding"), binding);
        return new Found(found.get(), !fine);
    }

    private static boolean sameBinding(JsonNode stored, JsonNode current) {
        if (stored == null || !stored.isObject()) return false;
        for (String k : KEYS) {
            if (!String.valueOf(stored.get(k)).equals(String.valueOf(current.get(k)))) return false;
        }
        return true;
    }

    // ---- policy limits and projection ----

    private Limits limits(Snapshot s) {
        String version = s.quote().path("policyVersion").asText(null);
        try {
            PolicyResult p = policy.getAssumption(RULES, new PolicyRead(s.binding().get("runId").asText(),
                    PolicyClock.iso(s.now()), version));
            JsonNode row = p.value();
            if (!p.ok() || !java.util.Objects.equals(p.policyVersion(), version) || row == null || !row.isObject()
                    || !version.equals(row.path("policyVersion").asText(null)) || !RULES.equals(row.path("key").asText(null))
                    || !List.of("assumed", "verified").contains(row.path("status").asText(null))
                    || !text(row.get("source")) || !ReviewValidation.validInstant(row.path("effectiveFrom").asText(null))
                    || !text(row.get("basis")) || !ReviewValidation.validDay(row.path("sourceDate").asText(null))
                    || !ReviewValidation.positiveSafe(row.path("value").get("maximumSpecialRequirements"))
                    || !ReviewValidation.positiveSafe(row.path("value").get("maximumReturnMileage"))) {
                return new Limits(null, ReviewResult.unavailable("policy"));
            }
            return new Limits(new ReviewValidation.Constraints(row.get("value").get("maximumSpecialRequirements").longValue(),
                    row.get("value").get("maximumReturnMileage").longValue(), row.deepCopy()), null);
        } catch (RuntimeException e) {
            return new Limits(null, ReviewResult.unavailable("policy"));
        }
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !ReviewValidation.blank(n.textValue());
    }

    private static ObjectNode constraintsJson(ReviewValidation.Constraints k) {
        ObjectNode n = F.objectNode();
        n.put("maximumSpecialRequirements", k.maximumSpecialRequirements()).put("maximumReturnMileage", k.maximumReturnMileage());
        n.put("mileageUnit", "mi").put("textLengthUnit", "UTF-16 code units");
        n.set("provenance", k.provenance().deepCopy());
        return n;
    }

    private static ObjectNode projection(Snapshot s, ReviewValidation.Constraints constraints) {
        boolean canEdit = s.editable();
        JsonNode choices = s.draft().path("choices");
        ObjectNode p = F.objectNode();
        p.set("binding", s.binding());
        p.put("reviewDetailsVersion", s.revision());
        p.set("details", s.metadata() != null ? s.metadata().get("details") : ReviewValidation.safeDetails(choices));
        p.set("constraints", constraintsJson(constraints));
        p.put("mode", choices.path("mode").asText());
        p.set("currentContract", s.draft().has("currentContract") ? s.draft().get("currentContract") : F.nullNode());
        ObjectNode collection = p.putObject("requestedCollection");
        collection.set("date", choices.has("requestedCollectionDate") ? choices.get("requestedCollectionDate") : F.nullNode());
        collection.set("locationId", choices.has("collectionLocationId") ? choices.get("collectionLocationId") : F.nullNode());
        p.set("oldContractId", choices.has("oldContractId") ? choices.get("oldContractId") : F.nullNode());
        p.set("contract", s.draft().has("contract") ? s.draft().get("contract") : F.nullNode());
        p.set("hold", s.hold());
        p.set("quote", s.quote());
        p.put("orderNumber", s.orderNumber()).put("stockVersion", s.stockVersion());
        p.put("now", PolicyClock.iso(s.now())).put("clockVersion", Long.toString(s.clockVersion()));
        p.put("frozen", s.frozen() != null).put("editable", canEdit).put("canContinue", canEdit);
        String hold = s.row().state();
        String state = s.frozen() != null ? "locked" : s.pending() || hold.endsWith("-pending") ? "pending"
                : canEdit ? "review" : "active".equals(hold) ? "expired" : hold;
        String action = canEdit ? "save-review-details" : s.frozen() != null || s.pending() ? "check-status" : "refresh-claim";
        p.set("view", ReviewResult.view(state, canEdit, action, "employee"));
        return p;
    }

    // ---- small helpers ----

    private Instant now(RunContext ctx) {
        try {
            Instant n = clock.now(ctx);
            return n == null ? null : n.truncatedTo(ChronoUnit.MILLIS);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean id(String v) {
        return v != null && !ReviewValidation.blank(v) && v.length() <= 100;
    }

    private static JsonNode json(String s) throws SQLException {
        try {
            return JSON.readTree(s);
        } catch (IOException e) {
            throw new SQLException("Stored review data is unreadable");
        }
    }
}
