package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.Work;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;

/**
 * Manual (cart) claims, local mode: a port of server/gcsp/manual-claims. The V1 custody_holds unique indexes
 * give exclusivity (shared with Buddy holds); each command is one TransactionRunner transaction, so a repeat replays.
 */
public final class ManualClaims {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String LOCAL = "local";
    private static final List<String> CLAIM_FIELDS = List.of("commandId", "orderUuid", "expectedStockVersion",
            "expectedDraftVersion", "expectedContextVersion", "expectedTermsDigest");
    private static final List<String> ACTION_FIELDS =
            List.of("commandId", "holdId", "expectedHoldVersion", "expectedDraftVersion");
    private static final List<String> RELEASE_FIELDS =
            List.of("commandId", "holdId", "expectedHoldVersion", "expectedDraftVersion", "reason");
    private static final Set<String> REASONS = Set.of("cancel", "change", "back");
    private static final String EVENT = "manual-claim-changed";

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final ClaimClock clock;
    private final ClaimTimingPort timing;
    private final ManualSelectionPort selection;
    private final SlotOccupancyPort occupancy;

    public ManualClaims(DataSource dataSource, ClaimClock clock, ClaimTimingPort timing,
            ManualSelectionPort selection, SlotOccupancyPort occupancy) {
        this(dataSource, new TransactionRunner(dataSource), clock, timing, selection, occupancy);
    }

    public ManualClaims(DataSource dataSource, TransactionRunner runner, ClaimClock clock, ClaimTimingPort timing,
            ManualSelectionPort selection, SlotOccupancyPort occupancy) {
        this.dataSource = dataSource;
        this.runner = runner;
        this.clock = clock;
        this.timing = timing;
        this.selection = selection;
        this.occupancy = occupancy;
    }

    /** The one place the terms digest is computed: digest of {policyVersion, terms}. */
    public static String termsDigest(String policyVersion, JsonNode terms) {
        ObjectNode n = JSON.createObjectNode();
        n.put("policyVersion", policyVersion);
        n.set("terms", terms);
        return Canonical.digest(n);
    }

    // ---- commands ----

    /** Takes the exact car for the employee: slot lock and occupancy, stock checks, hold, stock CAS and claim row. */
    public ClaimResult claim(ClaimScope scope, JsonNode input) {
        ClaimResult bad = shape(input, CLAIM_FIELDS);
        if (bad == null) bad = claimFields(input);
        if (bad != null) return bad;
        String orderUuid = input.get("orderUuid").textValue();
        long expectedDraft = input.get("expectedDraftVersion").longValue();
        Command cmd = command("manual-claim.claim", input);
        try {
            ClaimResult replay = replay(scope, cmd);
            if (replay != null) return replay;
            Instant now = now(scope);
            if (now == null) return new ClaimResult.Unavailable("clock-unavailable", true);
            ManualSelectionPort.Claimant who = selection.claimant(scope);
            if (who instanceof ManualSelectionPort.NoClaimant n) return unavailable(n.code());
            ManualSelectionPort.Known claimant = (ManualSelectionPort.Known) who;
            if (!claimant.policyVersion().equals(scope.policyVersion())) {
                throw conflict("policy-changed", "The policy version changed since the claim was shown.");
            }
            ClaimTimingPort.Timing t = timing.timing(scope, now);
            if (t instanceof ClaimTimingPort.Unavailable u) return unavailable(u.code());
            ClaimTimingPort.Known times = (ClaimTimingPort.Known) t;
            if (expectedDraft != claimant.draftVersion()) {
                throw stale("manual-draft", text(expectedDraft), text(claimant.draftVersion()));
            }
            String expectedContext = input.get("expectedContextVersion").textValue();
            if (!expectedContext.equals(claimant.contextVersion())) {
                throw stale("manual-context", expectedContext, claimant.contextVersion());
            }
            ManualSelectionPort.Decision d = selection.decide(scope, orderUuid);
            if (d instanceof ManualSelectionPort.NoDecision n) return unavailable(n.code());
            if (!(d instanceof ManualSelectionPort.Eligible decision) || decision.terms() == null
                    || decision.facts() == null || !decision.facts().isObject() || decision.validUntil() == null) {
                throw conflict("car-not-eligible-or-available", "That car is not available to this employee.");
            }
            String digest = termsDigest(claimant.policyVersion(), decision.terms());
            String expectedDigest = input.get("expectedTermsDigest").textValue();
            if (!expectedDigest.equals(digest)) throw stale("manual-terms", expectedDigest, digest);
            if (!decision.validUntil().isAfter(now)) throw conflict("quote-expired", "The quote has expired.");
            String id = Canonical.digest(JSON.createArrayNode().add(scope.runId()).add(scope.actorId()).add(cmd.commandId()));
            return answer(runner.execute(scope.context(), cmd, claimWork(scope, input, claimant, times, decision,
                    digest, "manual-hold:" + id, now)), cmd);
        } catch (Refusal r) {
            return r.result();
        }
    }

    /** First call moves the claim to order review and sets its expiry once; a second call returns the state. */
    public ClaimResult beginReview(ClaimScope scope, JsonNode input) {
        ClaimResult bad = shape(input, ACTION_FIELDS);
        if (bad == null) bad = actionFields(input);
        if (bad != null) return bad;
        String holdId = input.get("holdId").textValue();
        long expectedHold = input.get("expectedHoldVersion").longValue();
        long expectedDraft = input.get("expectedDraftVersion").longValue();
        Command cmd = command("manual-claim.review", input);
        try {
            ClaimResult replay = replay(scope, cmd);
            if (replay != null) return replay;
            Instant now = now(scope);
            if (now == null) return new ClaimResult.Unavailable("clock-unavailable", true);
            ClaimRow row = ownRow(scope, holdId);
            checkActive(row, expectedHold, expectedDraft, now);
            revalidate(scope, row, expectedDraft, now);
            long review = reviewSeconds(row);
            return answer(runner.execute(scope.context(), cmd, tx -> {
                ClaimRow r = locked(tx, scope, holdId);
                checkActive(r, expectedHold, expectedDraft, now);
                if ("preview".equals(r.phase()) && r.reviewStartedAt() == null) {
                    Instant expires = now.plusSeconds(review);
                    RunContext x = tx.context();
                    tx.cas("UPDATE custody_holds SET expires_at = ?, version = version + 1, updated_at = now() "
                            + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ?",
                            expires, x.environmentId(), x.runId(), holdId, r.version());
                    tx.cas("UPDATE manual_claims SET phase = 'order-review', review_started_at = ? "
                            + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND phase = 'preview'",
                            now, x.environmentId(), x.runId(), holdId);
                    emit(tx, holdId, r.version() + 1, "order-review");
                }
                return WorkResult.ok(reread(tx, holdId, now));
            }), cmd);
        } catch (Refusal r) {
            return r.result();
        }
    }

    /** Gives the car back; reason is cancel, change or back. */
    public ClaimResult release(ClaimScope scope, JsonNode input) {
        ClaimResult bad = shape(input, RELEASE_FIELDS);
        if (bad == null) bad = actionFields(input);
        if (bad == null && !(input.get("reason").isTextual() && REASONS.contains(input.get("reason").textValue()))) {
            bad = new ClaimResult.Invalid("reason", "Reason must be cancel, change or back.");
        }
        if (bad != null) return bad;
        String holdId = input.get("holdId").textValue();
        long expectedHold = input.get("expectedHoldVersion").longValue();
        long expectedDraft = input.get("expectedDraftVersion").longValue();
        String reason = input.get("reason").textValue();
        Command cmd = command("manual-claim.release", input);
        try {
            ClaimResult replay = replay(scope, cmd);
            if (replay != null) return replay;
            Instant now = now(scope);
            if (now == null) return new ClaimResult.Unavailable("clock-unavailable", true);
            checkActive(ownRow(scope, holdId), expectedHold, expectedDraft, now);
            return answer(runner.execute(scope.context(), cmd, tx -> {
                ClaimRow r = locked(tx, scope, holdId);
                checkActive(r, expectedHold, expectedDraft, now);
                finish(tx, r, "released", reason);
                return WorkResult.ok(reread(tx, holdId, now));
            }), cmd);
        } catch (Refusal r) {
            return r.result();
        }
    }

    /** Ordering's allocation (FUCQ-71): needs order review, revalidates, then commit and allocation share one transaction. */
    public ClaimResult convertSelection(ClaimScope scope, JsonNode input, SelectionCommit commit) {
        if (commit == null) return new ClaimResult.Unavailable("selection-commit-missing", false);
        ClaimResult bad = shape(input, ACTION_FIELDS);
        if (bad == null) bad = actionFields(input);
        if (bad != null) return bad;
        String holdId = input.get("holdId").textValue();
        long expectedHold = input.get("expectedHoldVersion").longValue();
        long expectedDraft = input.get("expectedDraftVersion").longValue();
        Command cmd = command("manual-claim.allocate", input);
        try {
            ClaimResult replay = replay(scope, cmd);
            if (replay != null) return replay;
            Instant now = now(scope);
            if (now == null) return new ClaimResult.Unavailable("clock-unavailable", true);
            ClaimRow row = ownRow(scope, holdId);
            checkActive(row, expectedHold, expectedDraft, now);
            requireReview(row);
            revalidate(scope, row, expectedDraft, now);
            return answer(runner.execute(scope.context(), cmd, tx -> {
                ClaimRow r = locked(tx, scope, holdId);
                checkActive(r, expectedHold, expectedDraft, now);
                requireReview(r);
                WorkResult done = commit.run(tx);
                if (done instanceof WorkResult.Refuse refuse) {
                    throw new Refusal(new ClaimResult.Conflict(refuse.code(), refuse.message(), null));
                }
                finish(tx, r, "allocated", null);
                return WorkResult.ok(reread(tx, holdId, now));
            }), cmd);
        } catch (Refusal r) {
            return r.result();
        }
    }

    /** The caller's latest claim; their own due hold expires first. No claim is not-found with the no-claim view. */
    public ClaimResult readClaim(ClaimScope scope) {
        try (Connection c = dataSource.getConnection()) {
            Instant now = now(scope);
            if (now == null) return new ClaimResult.Unavailable("clock-unavailable", true);
            Optional<ClaimRow> found = ClaimRow.latest(c, scope.environmentId(), scope.runId(), scope.employeeId());
            if (found.isEmpty()) return new ClaimResult.NotFound("This employee has no claim.", true);
            ClaimRow row = found.get();
            if ("active".equals(row.state()) && "cart".equals(row.holdType()) && row.due(now)) {
                expireOne(scope.context(), row.holdId(), now);
                row = ClaimRow.byHold(c, scope.environmentId(), scope.runId(), row.holdId(), false).orElse(row);
            }
            return new ClaimResult.Ok(row.view(now), false);
        } catch (SQLException e) {
            return new ClaimResult.Unavailable("database-unavailable", true);
        }
    }

    /** For ordering: the claim as it stands, or null when the hold is missing, not a manual claim or not theirs. */
    public ClaimView claimForOrdering(ClaimScope scope, String holdId) {
        try (Connection c = dataSource.getConnection()) {
            return ClaimRow.byHold(c, scope.environmentId(), scope.runId(), holdId, false)
                    .filter(r -> "cart".equals(r.holdType()) && r.employeeId().equals(scope.employeeId()))
                    .map(ClaimRow::forOrdering).orElse(null);
        } catch (SQLException e) {
            throw new IllegalStateException("The claim could not be read", e);
        }
    }

    /** For ordering, inside its own transaction: is this an unexpired active manual claim of the employee at that version? */
    public boolean ownsActiveClaim(Tx tx, String employeeId, String holdId, long expectedHoldVersion)
            throws SQLException {
        RunContext x = tx.context();
        Instant now = clock.now(x).truncatedTo(ChronoUnit.MILLIS);
        return tx.first("SELECT 1 FROM custody_holds h JOIN manual_claims c ON c.environment_id = h.environment_id "
                + "AND c.run_id = h.run_id AND c.hold_id = h.hold_id WHERE h.environment_id = ? AND h.run_id = ? "
                + "AND h.hold_id = ? AND h.employee_id = ? AND h.hold_type = 'cart' AND h.state = 'active' "
                + "AND h.version = ? AND h.expires_at > ?", rs -> 1, x.environmentId(), x.runId(), holdId,
                employeeId, expectedHoldVersion, now).isPresent();
    }

    /** Expires up to limit due preview or review holds, one short transaction each; returns how many expired. */
    public int expireDue(ClaimScope systemScope, int limit) {
        if (limit <= 0) return 0;
        Instant now = now(systemScope);
        if (now == null) return 0;
        List<String> due;
        try (Connection c = dataSource.getConnection()) {
            due = Db.list(c, "SELECT hold_id FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                    + "AND hold_type = 'cart' AND state = 'active' AND expires_at <= ? "
                    + "ORDER BY expires_at, hold_id LIMIT ?", rs -> rs.getString(1), systemScope.environmentId(),
                    systemScope.runId(), now, limit);
        } catch (SQLException e) {
            return 0;
        }
        int expired = 0;
        for (String holdId : due) {
            if (expireOne(systemScope.context(), holdId, now)) expired++;
        }
        return expired;
    }

    // ---- claim transaction ----

    private record Car(String state, long version, String configurationId, JsonNode attributes) {}

    private record Occupant(String holdId, String type, String state, Instant expiresAt, String orderUuid) {}

    private Work claimWork(ClaimScope scope, JsonNode input, ManualSelectionPort.Known claimant,
            ClaimTimingPort.Known times, ManualSelectionPort.Eligible decision, String digest, String holdId,
            Instant now) {
        String order = input.get("orderUuid").textValue();
        long expectedStock = input.get("expectedStockVersion").longValue();
        return tx -> {
            Connection c = tx.connection();
            RunContext x = tx.context();
            String slot = claimant.slotId();
            if (Db.first(c, "SELECT 1 FROM entitlement_slots WHERE environment_id = ? AND run_id = ? "
                    + "AND slot_id = ? AND employee_id = ? FOR UPDATE", rs -> 1, x.environmentId(), x.runId(), slot,
                    scope.employeeId()).isEmpty()) {
                throw conflict("entitlement-unavailable", "This employee has no such entitlement slot.");
            }
            Car car = Db.first(c, "SELECT state, version, configuration_id, attributes::text FROM stock_cars "
                    + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", rs -> new Car(rs.getString(1),
                    rs.getLong(2), rs.getString(3), json(rs.getString(4))), x.environmentId(), x.runId(), order)
                    .orElseThrow(() -> conflict("car-not-eligible-or-available", "That car is not available."));
            int bumps = 0;
            List<Occupant> held = Db.list(c, "SELECT hold_id, hold_type, state, expires_at, order_uuid FROM custody_holds "
                    + "WHERE environment_id = ? AND run_id = ? AND employee_id = ? AND slot_id = ? "
                    + "AND state IN ('active', 'claim-pending', 'release-pending', 'selection-pending', 'allocated') "
                    + "ORDER BY hold_id LIMIT 20", rs -> new Occupant(rs.getString(1), rs.getString(2),
                    rs.getString(3), Db.instant(rs, 4), rs.getString(5)), x.environmentId(), x.runId(),
                    scope.employeeId(), slot);
            Occupant buddy = null;
            Occupant cart = null;
            boolean allocated = false;
            for (Occupant o : held) {
                boolean due = "cart".equals(o.type()) && "active".equals(o.state()) && !o.expiresAt().isAfter(now);
                if (due && expireInTx(tx, o.holdId(), now)) {
                    if (o.orderUuid().equals(order)) bumps++;
                } else if ("allocated".equals(o.state())) {
                    allocated = true;
                } else if ("buddy-offer".equals(o.type())) {
                    if (buddy == null) buddy = o;
                } else if (cart == null) {
                    cart = o;
                }
            }
            if (buddy != null) {
                ObjectNode extra = JSON.createObjectNode().put("holdId", buddy.holdId());
                Optional<String> offer = occupancy.heldOfferId(tx, buddy.holdId());
                if (offer.isPresent()) extra.put("offerId", offer.get()); else extra.putNull("offerId");
                throw new Refusal(new ClaimResult.Conflict("offer-held",
                        "Another offer already holds this entitlement.", extra));
            }
            if (cart != null) throw conflict("release-required", "Release the current claim before choosing another car.");
            if (allocated) throw conflict("entitlement-unavailable", "This entitlement already has an allocated car.");
            for (String dueId : Db.list(c, "SELECT hold_id FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                    + "AND order_uuid = ? AND hold_type = 'cart' AND state = 'active' AND expires_at <= ? "
                    + "ORDER BY hold_id LIMIT 5", rs -> rs.getString(1), x.environmentId(), x.runId(), order, now)) {
                if (expireInTx(tx, dueId, now)) bumps++;
            }
            if (car.version() != expectedStock) throw stale("stock", text(expectedStock), text(car.version()));
            if (!"released".equals(car.state())) throw conflict("stock-unavailable", "That car is no longer in stock.");
            if (!car.configurationId().equals(decision.configurationId()) || !factsMatch(car.attributes(), decision.facts())) {
                throw conflict("stock-facts-changed", "The car's details changed since it was shown.");
            }
            tx.write("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, "
                    + "slot_unit, hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'cart', 'active', ?)",
                    x.environmentId(), x.runId(), holdId, order, scope.employeeId(), slot,
                    now.plusSeconds(times.previewSeconds()));
            tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? "
                    + "AND run_id = ? AND order_uuid = ? AND version = ?", x.environmentId(), x.runId(), order,
                    car.version() + bumps);
            ObjectNode quote = quote(scope, claimant, times, decision, digest, order, slot, now, car.version() + bumps + 1);
            tx.write("INSERT INTO manual_claims (environment_id, run_id, hold_id, employee_id, slot_id, order_uuid, "
                    + "mode, phase, policy_version, draft_version, context_version, terms_digest, quote, quoted_at, "
                    + "valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, 'preview', ?, ?, ?, ?, ?, ?, ?)", x.environmentId(),
                    x.runId(), holdId, scope.employeeId(), slot, order, LOCAL, claimant.policyVersion(),
                    claimant.draftVersion(), claimant.contextVersion(), digest, quote, now, decision.validUntil());
            emit(tx, holdId, 1, "active");
            return WorkResult.ok(reread(tx, holdId, now));
        };
    }

    private static ObjectNode quote(ClaimScope scope, ManualSelectionPort.Known claimant, ClaimTimingPort.Known times,
            ManualSelectionPort.Eligible decision, String digest, String order, String slot, Instant now, long stockVersion) {
        ObjectNode q = JSON.createObjectNode();
        q.put("orderUuid", order);
        q.put("employeeId", scope.employeeId());
        q.put("entitlementSlotId", slot);
        q.put("configurationId", decision.configurationId());
        q.set("facts", decision.facts().deepCopy());
        q.set("terms", decision.terms().deepCopy());
        q.put("termsDigest", digest);
        q.put("policyVersion", claimant.policyVersion());
        q.put("contextVersion", claimant.contextVersion());
        q.put("draftVersion", claimant.draftVersion());
        if (claimant.driverId() == null) q.putNull("driverId"); else q.put("driverId", claimant.driverId());
        q.put("stockVersion", stockVersion);
        q.put("quotedAt", PolicyClock.iso(now));
        q.put("validUntil", PolicyClock.iso(decision.validUntil()));
        ObjectNode t = q.putObject("timing");
        t.put("previewSeconds", times.previewSeconds());
        t.put("reviewSeconds", times.reviewSeconds());
        t.put("transition", "once-from-preview");
        t.set("assumptions", times.assumptions());
        return q;
    }

    /** Every field of the decision's facts must still equal the car's recorded attribute. */
    private static boolean factsMatch(JsonNode attributes, JsonNode facts) {
        var names = facts.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            JsonNode a = attributes.get(name);
            JsonNode f = facts.get(name);
            if (a == null || (a.isIntegralNumber() && f.isIntegralNumber() ? a.longValue() != f.longValue() : !a.equals(f))) {
                return false;
            }
        }
        return true;
    }

    // ---- shared transaction steps ----

    /** Moves the hold to a terminal state and bumps the car's version; allocated also marks the car allocated. */
    private void finish(Tx tx, ClaimRow r, String target, String reason) throws SQLException {
        RunContext x = tx.context();
        tx.cas("UPDATE custody_holds SET state = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ?", target, x.environmentId(),
                x.runId(), r.holdId(), r.version());
        if (reason != null) {
            tx.cas("UPDATE manual_claims SET release_reason = ? WHERE environment_id = ? AND run_id = ? AND hold_id = ?",
                    reason, x.environmentId(), x.runId(), r.holdId());
        }
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now()"
                + ("allocated".equals(target) ? ", state = 'allocated'" : "")
                + " WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", x.environmentId(), x.runId(),
                r.orderUuid());
        emit(tx, r.holdId(), r.version() + 1, target);
    }

    /** Expires one due active cart hold inside the open transaction; false when it is no longer due or active. */
    private boolean expireInTx(Tx tx, String holdId, Instant now) throws SQLException {
        RunContext x = tx.context();
        Optional<ClaimRow> row = ClaimRow.byHold(tx.connection(), x.environmentId(), x.runId(), holdId, true);
        if (row.isEmpty()) return false;
        ClaimRow r = row.get();
        if (!"cart".equals(r.holdType()) || !"active".equals(r.state()) || !r.due(now)) return false;
        finish(tx, r, "expired", "expiry");
        return true;
    }

    private boolean expireOne(RunContext ctx, String holdId, Instant now) {
        ObjectNode in = JSON.createObjectNode();
        in.put("holdId", holdId);
        // Expiry is keyed by hold and version so a repeat of the same sweep step is a replay.
        long version;
        String expiresAt;
        try (Connection c = dataSource.getConnection()) {
            Optional<ClaimRow> row = ClaimRow.byHold(c, ctx.environmentId(), ctx.runId(), holdId, false);
            if (row.isEmpty()) return false;
            version = row.get().version();
            expiresAt = PolicyClock.iso(row.get().expiresAt());
        } catch (SQLException e) {
            return false;
        }
        in.put("expiresAt", expiresAt);
        in.put("version", version);
        String id = "manual-claims:expiry:" + Canonical.digest(in);
        Outcome o = runner.execute(ctx, new Command("manual-claim.expire", id, in), tx -> {
            expireInTx(tx, holdId, now);
            return WorkResult.ok(in);
        });
        return o instanceof Outcome.Committed c && c.changed();
    }

    private static void emit(Tx tx, String holdId, long version, String state) {
        ObjectNode p = JSON.createObjectNode();
        p.put("holdId", holdId);
        p.put("state", state);
        p.put("version", version);
        tx.emit(EVENT + ":" + holdId + ":" + version, EVENT, p);
    }

    private static ClaimRow locked(Tx tx, ClaimScope scope, String holdId) throws SQLException {
        RunContext x = tx.context();
        ClaimRow r = ClaimRow.byHold(tx.connection(), x.environmentId(), x.runId(), holdId, true)
                .orElseThrow(() -> new Refusal(new ClaimResult.NotFound("No such claim.", false)));
        owner(scope, r);
        return r;
    }

    private static ObjectNode reread(Tx tx, String holdId, Instant now) throws SQLException {
        RunContext x = tx.context();
        return ClaimRow.byHold(tx.connection(), x.environmentId(), x.runId(), holdId, false).orElseThrow().view(now);
    }

    private ClaimRow ownRow(ClaimScope scope, String holdId) {
        try (Connection c = dataSource.getConnection()) {
            ClaimRow r = ClaimRow.byHold(c, scope.environmentId(), scope.runId(), holdId, false)
                    .orElseThrow(() -> new Refusal(new ClaimResult.NotFound("No such claim.", false)));
            owner(scope, r);
            return r;
        } catch (SQLException e) {
            throw new Refusal(new ClaimResult.Unavailable("database-unavailable", true));
        }
    }

    private static void owner(ClaimScope scope, ClaimRow r) {
        if (!r.employeeId().equals(scope.employeeId()) || !"cart".equals(r.holdType())) {
            throw new Refusal(new ClaimResult.Forbidden("This claim belongs to another entitlement."));
        }
    }

    private static void checkActive(ClaimRow r, long expectedHold, long expectedDraft, Instant now) {
        if (r.version() != expectedHold) throw stale("hold", text(expectedHold), text(r.version()));
        if (r.draftVersion() != expectedDraft) throw stale("manual-draft", text(expectedDraft), text(r.draftVersion()));
        if (!"active".equals(r.state())) throw conflict("claim-not-active", "This claim is no longer active.");
        if (r.due(now)) throw conflict("claim-expired", "This claim has expired.");
    }

    private static void requireReview(ClaimRow r) {
        if (!"order-review".equals(r.phase())) throw conflict("order-review-required", "Start the order review first.");
    }

    /** The pinned quote still holds: same context, draft, terms and facts, and not past its validity. */
    private void revalidate(ClaimScope scope, ClaimRow row, long expectedDraft, Instant now) {
        ManualSelectionPort.Claimant who = selection.claimant(scope);
        if (who instanceof ManualSelectionPort.NoClaimant n) throw new Refusal(unavailable(n.code()));
        ManualSelectionPort.Known claimant = (ManualSelectionPort.Known) who;
        if (!claimant.contextVersion().equals(row.contextVersion())) {
            throw conflict("context-changed-release-required", "Your details changed. Release this claim and start again.");
        }
        if (claimant.draftVersion() != expectedDraft) {
            throw stale("manual-draft", text(expectedDraft), text(claimant.draftVersion()));
        }
        ManualSelectionPort.Decision d = selection.decide(scope, row.orderUuid());
        if (d instanceof ManualSelectionPort.NoDecision n) throw new Refusal(unavailable(n.code()));
        if (!(d instanceof ManualSelectionPort.Eligible decision) || decision.terms() == null || decision.facts() == null) {
            throw conflict("car-no-longer-eligible", "That car is no longer available to this employee.");
        }
        if (!termsDigest(claimant.policyVersion(), decision.terms()).equals(row.termsDigest())
                || !Canonical.digest(decision.facts()).equals(Canonical.digest(row.quote().path("facts")))) {
            throw conflict("quote-changed-release-required", "The quote changed. Release this claim and start again.");
        }
        if (!row.validUntil().isAfter(now)) throw conflict("quote-expired", "The quote has expired.");
    }

    private static long reviewSeconds(ClaimRow row) {
        JsonNode s = row.quote().path("timing").path("reviewSeconds");
        if (!s.isIntegralNumber() || s.longValue() <= 0) {
            throw new Refusal(new ClaimResult.Unavailable("claim-timing-unavailable", false));
        }
        return s.longValue();
    }

    // ---- replay, answers, validation ----

    private static Command command(String type, JsonNode input) {
        ObjectNode wrapped = JSON.createObjectNode();
        wrapped.put("kind", type);
        wrapped.set("input", input);
        return new Command(type, input.get("commandId").textValue(), wrapped);
    }

    /** A command id that already committed answers from its receipt, before any live check can disagree with it. */
    private ClaimResult replay(ClaimScope scope, Command cmd) {
        Inspection seen = runner.inspect(scope.context(), cmd.commandId());
        if (seen instanceof Inspection.Unavailable) return new ClaimResult.Unavailable("database-unavailable", true);
        if (!(seen instanceof Inspection.Committed)) return null;
        return answer(runner.execute(scope.context(), cmd, tx -> {
            throw new IllegalStateException("a committed command id is answered from its receipt");
        }), cmd);
    }

    private ClaimResult answer(Outcome o, Command cmd) {
        if (o instanceof Outcome.Committed c) return new ClaimResult.Ok(c.result(), c.replayed());
        if (o instanceof Outcome.Uncertain u) return new ClaimResult.Pending(u.operationId(), true);
        if (o instanceof Outcome.Conflict c) {
            String code = "command-input-changed".equals(c.code()) ? "idempotency-input-changed" : c.code();
            return new ClaimResult.Conflict(code, c.message(), null);
        }
        if (o instanceof Outcome.Refused r) return new ClaimResult.Conflict(r.code(), r.message(), null);
        return new ClaimResult.Unavailable("database-unavailable", true);
    }

    private Instant now(ClaimScope scope) {
        try {
            Instant n = clock.now(scope.context());
            return n == null ? null : n.truncatedTo(ChronoUnit.MILLIS);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static ClaimResult unavailable(String code) {
        return new ClaimResult.Unavailable(code, !code.endsWith("not-configured"));
    }

    private static Refusal conflict(String code, String message) {
        return new Refusal(new ClaimResult.Conflict(code, message, null));
    }

    private static Refusal stale(String resource, String expected, String current) {
        ObjectNode extra = JSON.createObjectNode();
        extra.put("resource", resource);
        extra.put("expectedVersion", expected);
        extra.put("currentVersion", current);
        return new Refusal(new ClaimResult.Conflict("stale-version", "The " + resource + " changed since it was shown.", extra));
    }

    private static String text(long n) {
        return Long.toString(n);
    }

    private static JsonNode json(String s) throws SQLException {
        try {
            return JSON.readTree(s);
        } catch (java.io.IOException e) {
            throw new SQLException("Stored attributes are unreadable");
        }
    }

    private static ClaimResult shape(JsonNode input, List<String> fields) {
        if (input == null || !input.isObject()) return new ClaimResult.Invalid("command", "Send the registered command fields.");
        var names = input.fieldNames();
        while (names.hasNext()) {
            if (!fields.contains(names.next())) return new ClaimResult.Invalid("command", "Supply only the registered command fields.");
        }
        for (String f : fields) {
            if (!input.has(f)) return new ClaimResult.Invalid(f, "This field is required.");
        }
        return isText(input.get("commandId")) ? null : new ClaimResult.Invalid("commandId", "Send a command id.");
    }

    private static ClaimResult claimFields(JsonNode in) {
        if (!isText(in.get("orderUuid"))) return new ClaimResult.Invalid("orderUuid", "Send the car's order id.");
        if (!positive(in.get("expectedStockVersion"))) return new ClaimResult.Invalid("expectedStockVersion", "Send the stock version.");
        if (!positive(in.get("expectedDraftVersion"))) return new ClaimResult.Invalid("expectedDraftVersion", "Send the draft version.");
        if (!isText(in.get("expectedContextVersion"))) return new ClaimResult.Invalid("expectedContextVersion", "Send the context version.");
        if (!isText(in.get("expectedTermsDigest"))) return new ClaimResult.Invalid("expectedTermsDigest", "Send the terms digest.");
        return null;
    }

    private static ClaimResult actionFields(JsonNode in) {
        if (!isText(in.get("holdId"))) return new ClaimResult.Invalid("holdId", "Send the hold id.");
        if (!positive(in.get("expectedHoldVersion"))) return new ClaimResult.Invalid("expectedHoldVersion", "Send the hold version.");
        if (!positive(in.get("expectedDraftVersion"))) return new ClaimResult.Invalid("expectedDraftVersion", "Send the draft version.");
        return null;
    }

    private static boolean isText(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() && n.textValue().length() <= 128;
    }

    private static boolean positive(JsonNode n) {
        return n != null && n.isIntegralNumber() && n.canConvertToLong() && n.longValue() > 0;
    }
}
