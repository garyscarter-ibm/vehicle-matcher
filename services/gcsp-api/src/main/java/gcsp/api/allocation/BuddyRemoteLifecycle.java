package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.notify.NotificationIntent;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import javax.sql.DataSource;

/**
 * Drives remote Buddy claims and releases: record an attempt, call the remote outside any transaction, then act on
 * the acknowledgement. Uncertain stock is never freed; an open operation keeps its hold until the remote settles it.
 */
public final class BuddyRemoteLifecycle {

    private static final int PAGE = 100;
    private static final String UNKNOWN = "unknown";

    private record Pend(String state, int attempts, long version, JsonNode outcome) {
        boolean open() {
            return "intent".equals(state) || "pending".equals(state);
        }

        String lastKnown() {
            return outcome == null ? UNKNOWN : outcome.path("lastKnownState").asText(UNKNOWN);
        }
    }

    private enum Validity { VALID, INVALID, UNAVAILABLE }

    private final DataSource dataSource;
    private final PolicyService policy;
    private final EligibleCandidates candidates;
    private final RemoteBuddy remote;

    public BuddyRemoteLifecycle(DataSource dataSource, PolicyService policy, EligibleCandidates candidates,
            RemoteBuddy remote) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.candidates = candidates;
        this.remote = remote;
    }

    /** One drive of an operation: attempt, remote call, acknowledgement; a not-found after reconcile retries once. */
    public DriveResult drive(AllocationScope scope, String operationId) {
        String problem = scope == null ? "The allocation scope is missing." : scope.problem();
        if (problem != null) return new DriveResult.Refused("invalid-scope");
        if (operationId == null || operationId.isBlank()) return new DriveResult.Refused("operation-not-found");
        if (!"remote".equals(remote.mode())) return new DriveResult.Refused("buddy-remote-unavailable");
        RunContext ctx = new RunContext(scope.environmentId(), scope.runId(), AllocationService.ACTOR);
        TransactionRunner runner = new TransactionRunner(dataSource);
        try {
            JsonNode first = attempt(scope, ctx, runner, operationId);
            JsonNode last = "retry".equals(first.path("kind").asText()) ? attempt(scope, ctx, runner, operationId) : first;
            return decode(last);
        } catch (SQLException e) {
            return new DriveResult.Pending("database-unavailable", UNKNOWN);
        }
    }

    /** Restart and pending reconciliation: drives every open claim and release, in operation id order. */
    public ReconcileResult reconcile(AllocationScope scope) {
        String problem = scope == null ? "The allocation scope is missing." : scope.problem();
        if (problem != null) return new ReconcileResult(0, 0, 0, 0, null);
        int driven = 0;
        int settled = 0;
        int pending = 0;
        int refused = 0;
        String firstPending = null;
        String after = "";
        while (true) {
            List<String> page;
            try (Connection c = dataSource.getConnection()) {
                page = Sql.query(c, "SELECT operation_id FROM pending_operations WHERE environment_id = ? AND run_id = ? "
                        + "AND operation_type IN ('buddy-claim', 'buddy-release') AND state IN ('intent', 'pending') "
                        + "AND operation_id > ? ORDER BY operation_id LIMIT ?", rs -> rs.getString(1),
                        scope.environmentId(), scope.runId(), after, PAGE);
            } catch (SQLException e) {
                return new ReconcileResult(driven, settled, pending + 1, refused, firstPending);
            }
            for (String id : page) {
                DriveResult r = drive(scope, id);
                driven++;
                if (r instanceof DriveResult.Settled) {
                    settled++;
                } else if (r instanceof DriveResult.Refused) {
                    refused++;
                } else {
                    pending++;
                    if (firstPending == null) firstPending = id;
                }
            }
            if (page.size() < PAGE) break;
            after = page.get(page.size() - 1);
        }
        return new ReconcileResult(driven, settled, pending, refused, firstPending);
    }

    /** Steps one to three of a drive; the result is a settled, pending or retry JSON (see the codec at the end). */
    private JsonNode attempt(AllocationScope scope, RunContext ctx, TransactionRunner runner, String operationId)
            throws SQLException {
        Pend seen;
        try (Connection c = dataSource.getConnection()) {
            seen = pend(c, ctx, operationId);
        }
        if (seen == null) return refusedJson("operation-not-found");
        if (!seen.open()) return settledJson(seen.state(), seen.outcome());
        int next = seen.attempts() + 1;
        Command attempt = new Command("buddy.attempt", operationId + ":attempt:" + next,
                Sql.JSON.createObjectNode().put("operationId", operationId).put("attempt", next));
        Outcome o = AllocationService.settle(runner, ctx, attempt.commandId(), () -> runner.execute(ctx, attempt,
                tx -> attemptWork(tx, operationId, seen.attempts())));
        JsonNode prepared = answer(o);
        if (!"attempt".equals(prepared.path("kind").asText())) return prepared;

        JsonNode p = prepared.path("payload");
        RemoteBuddy.RemoteOperation op = new RemoteBuddy.RemoteOperation(operationId, prepared.path("type").asText(),
                ctx.runId(), prepared.path("holdId").asText(), p.path("orderUuid").asText(), p.path("employeeId").asText(),
                p, prepared.path("attempts").asInt());
        RemoteBuddy.Ack ack = null;
        try {
            ack = "execute".equals(prepared.path("method").asText()) ? remote.execute(op) : remote.reconcile(op);
        } catch (Exception e) {
            // A lost or failed call is an unknown answer, never a refusal.
        }
        RemoteBuddy.Ack received = ack;
        String method = prepared.path("method").asText();
        long version = prepared.path("version").asLong();
        Command ackCommand = new Command("buddy.ack", operationId + ":ack:" + op.attempts(),
                Sql.JSON.createObjectNode().put("operationId", operationId).put("attempt", op.attempts()));
        Outcome done = AllocationService.settle(runner, ctx, ackCommand.commandId(), () -> runner.execute(ctx, ackCommand,
                tx -> ackWork(tx, scope, operationId, version, method, received)));
        return answer(done);
    }

    private static WorkResult attemptWork(Tx tx, String operationId, int expectedAttempts) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        Pend p = lock(c, x, operationId);
        if (p == null) return WorkResult.refuse("operation-not-found", "No such operation.");
        if (!p.open()) return WorkResult.ok(settledJson(p.state(), p.outcome()));
        if (p.attempts() != expectedAttempts) return WorkResult.ok(pendingJson("operation-moved", p.lastKnown()));
        RemoteOps.Rows rows = RemoteOps.load(c, x, operationId);
        if (rows == null || !RemoteOps.aligned(c, x, rows)) {
            return WorkResult.ok(pendingJson("authority-reconciliation-required", p.lastKnown()));
        }
        String method = p.attempts() == 0 || "not-found".equals(p.lastKnown()) ? "execute" : "reconcile";
        String state = rows.op().claim() ? "claim-pending" : "release-pending";
        ObjectNode outcome = Sql.JSON.createObjectNode().put("lastKnownState", state).put("method", method);
        tx.cas("UPDATE pending_operations SET state = 'pending', attempts = attempts + 1, outcome = ?, "
                + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? AND operation_id = ? "
                + "AND version = ? AND state IN ('intent', 'pending')", outcome, x.environmentId(), x.runId(),
                operationId, p.version());
        ObjectNode out = Sql.JSON.createObjectNode().put("kind", "attempt").put("method", method)
                .put("attempts", p.attempts() + 1).put("version", p.version() + 1).put("type", rows.op().type())
                .put("holdId", rows.op().holdId());
        out.set("payload", rows.op().payload());
        return WorkResult.ok(out);
    }

    private WorkResult ackWork(Tx tx, AllocationScope scope, String operationId, long version, String method,
            RemoteBuddy.Ack ack) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        Pend p = lock(c, x, operationId);
        if (p == null) return WorkResult.refuse("operation-not-found", "No such operation.");
        if (!p.open()) return WorkResult.ok(settledJson(p.state(), p.outcome()));
        if (p.version() != version || !"pending".equals(p.state())) {
            return WorkResult.ok(pendingJson("operation-moved", p.lastKnown()));
        }
        RemoteOps.Rows rows = RemoteOps.load(c, x, operationId);
        if (rows == null || !RemoteOps.aligned(c, x, rows)) {
            return WorkResult.ok(pendingJson("authority-reconciliation-required", p.lastKnown()));
        }
        RemoteOps.Op op = rows.op();
        JsonNode payload = op.payload();
        boolean matched = ack != null && ("confirmed".equals(ack.status()) || "rejected".equals(ack.status())
                || "not-found".equals(ack.status())) && operationId.equals(ack.operationId())
                && x.runId().equals(ack.runId()) && payload.path("orderUuid").asText().equals(ack.orderUuid());
        if (!matched || !op.claim() && "rejected".equals(ack.status())) {
            return remember(tx, operationId, p, method, matched ? "rejected" : UNKNOWN,
                    matched ? "release-rejected" : "remote-unconfirmed");
        }
        Instant now = scope.now();
        if ("not-found".equals(ack.status())) {
            // Only an authoritative reconcile absence permits another execute.
            if (!"reconcile".equals(method)) return remember(tx, operationId, p, method, UNKNOWN, "remote-not-found");
            Validity v = op.claim() ? validity(c, x, scope, rows) : Validity.VALID;
            if (v == Validity.UNAVAILABLE) return WorkResult.ok(pendingJson("recommendation-unavailable", p.lastKnown()));
            if (v == Validity.VALID) {
                setLastKnown(tx, operationId, p, method, "not-found");
                return WorkResult.ok(Sql.JSON.createObjectNode().put("kind", "retry"));
            }
            boolean lapsed = !now.isBefore(rows.hold().expiresAt());
            ObjectNode out = RemoteOps.close(tx, rows, lapsed ? "expired" : "released",
                    lapsed ? "buddy-expired" : "prerequisites-changed", now);
            RemoteOps.closeOperation(tx, operationId, p.version(), "refused", out);
            return WorkResult.ok(settledJson("refused", out));
        }
        if (!op.claim()) {
            if (rows.car().version() != payload.path("expectedStockVersion").asLong(-1)) {
                return WorkResult.ok(pendingJson("stock-reconciliation-required", p.lastKnown()));
            }
            ObjectNode out = RemoteOps.close(tx, rows, payload.path("target").asText(), payload.path("reason").asText(), now);
            RemoteOps.closeOperation(tx, operationId, p.version(), "acknowledged", out);
            return WorkResult.ok(settledJson("acknowledged", out));
        }
        if ("rejected".equals(ack.status())) {
            ObjectNode out = RemoteOps.close(tx, rows, "released", "buddy-claim-rejected", now);
            RemoteOps.closeOperation(tx, operationId, p.version(), "refused", out);
            return WorkResult.ok(settledJson("refused", out));
        }
        Validity v = validity(c, x, scope, rows);
        if (v == Validity.UNAVAILABLE) return WorkResult.ok(pendingJson("recommendation-unavailable", p.lastKnown()));
        if (v == Validity.VALID) return offered(tx, rows, p);
        String reason = !now.isBefore(rows.hold().expiresAt()) ? "buddy-expired" : "prerequisites-changed";
        String releaseId = RemoteOps.startRelease(tx, rows, reason);
        ObjectNode out = Sql.JSON.createObjectNode().put("state", "release-pending").put("releaseOperationId", releaseId);
        RemoteOps.closeOperation(tx, operationId, p.version(), "acknowledged", out);
        return WorkResult.ok(settledJson("acknowledged", out));
    }

    /** A confirmed, still valid claim: the hold goes active, the offer exists and its one notification is queued. */
    private static WorkResult offered(Tx tx, RemoteOps.Rows rows, Pend p) throws SQLException {
        RunContext x = tx.context();
        JsonNode payload = rows.op().payload();
        RemoteOps.Hold h = rows.hold();
        tx.cas("UPDATE custody_holds SET state = 'active', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? AND state = 'claim-pending'",
                x.environmentId(), x.runId(), h.holdId(), h.version());
        String offerId = payload.path("offerId").asText();
        tx.write("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, "
                + "state, brief_version, policy_version, expires_at, operation_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)", x.environmentId(), x.runId(), offerId, h.holdId(),
                payload.path("quoteId").asText(), h.employeeId(), h.orderUuid(), payload.path("expectedBriefVersion").asLong(),
                payload.path("policyVersion").asText(), h.expiresAt(), rows.op().operationId());
        NotificationIntent.offer(tx, offerId, h.employeeId());
        ObjectNode out = Sql.JSON.createObjectNode().put("state", "offered").put("offerId", offerId)
                .put("holdId", h.holdId()).put("quoteId", payload.path("quoteId").asText());
        RemoteOps.closeOperation(tx, rows.op().operationId(), p.version(), "acknowledged", out);
        return WorkResult.ok(settledJson("acknowledged", out));
    }

    /** An unanswered or refused-to-confirm call: the operation stays pending and its custody is kept. */
    private static WorkResult remember(Tx tx, String operationId, Pend p, String method, String lastKnown, String code)
            throws SQLException {
        setLastKnown(tx, operationId, p, method, lastKnown);
        return WorkResult.ok(pendingJson(code, lastKnown));
    }

    private static void setLastKnown(Tx tx, String operationId, Pend p, String method, String lastKnown)
            throws SQLException {
        RunContext x = tx.context();
        ObjectNode outcome = Sql.JSON.createObjectNode().put("lastKnownState", lastKnown).put("method", method);
        tx.cas("UPDATE pending_operations SET outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? AND state = 'pending'",
                outcome, x.environmentId(), x.runId(), operationId, p.version());
    }

    /** Whether the confirmed claim is still one the system would make today; unknown inputs never release stock. */
    private Validity validity(Connection c, RunContext x, AllocationScope scope, RemoteOps.Rows rows)
            throws SQLException {
        JsonNode p = rows.op().payload();
        RemoteOps.Hold h = rows.hold();
        Instant now = scope.now();
        Object[] quote = Sql.one(c, "SELECT valid_until, quote::text FROM buddy_quotes WHERE environment_id = ? AND run_id = ? "
                + "AND quote_id = ?", rs -> new Object[] {Sql.instant(rs, 1), Sql.json(rs.getString(2))}, x.environmentId(),
                x.runId(), p.path("quoteId").asText());
        if (quote == null) return Validity.INVALID;
        Instant validUntil = (Instant) quote[0];
        if (!now.isBefore(h.expiresAt()) || validUntil != null && !validUntil.isAfter(now)) return Validity.INVALID;
        Object[] employee = Sql.one(c, "SELECT e.version, e.attributes::text, s.version FROM employees e JOIN entitlement_slots s "
                + "ON s.environment_id = e.environment_id AND s.run_id = e.run_id AND s.slot_id = ? AND s.employee_id = e.employee_id "
                + "WHERE e.environment_id = ? AND e.run_id = ? AND e.employee_id = ?",
                rs -> new Object[] {rs.getLong(1), Sql.json(rs.getString(2)), rs.getLong(3)}, h.slotId(), x.environmentId(),
                x.runId(), h.employeeId());
        if (employee == null || rows.car().version() != p.path("expectedStockVersion").asLong(-1)
                || (Long) employee[2] != p.path("expectedSlotVersion").asLong(-1)
                || (Long) employee[0] != p.path("expectedEmployeeVersion").asLong(-1)) {
            return Validity.INVALID;
        }
        Object[] head = Sql.one(c, "SELECT h.brief_version, b.buddy::text, b.content::text FROM brief_heads h JOIN briefs b "
                + "ON b.environment_id = h.environment_id AND b.run_id = h.run_id AND b.employee_id = h.employee_id "
                + "AND b.brief_version = h.brief_version WHERE h.environment_id = ? AND h.run_id = ? AND h.employee_id = ?",
                rs -> new Object[] {rs.getLong(1), Sql.json(rs.getString(2)), Sql.json(rs.getString(3))}, x.environmentId(),
                x.runId(), h.employeeId());
        if (head == null || (Long) head[0] != p.path("expectedBriefVersion").asLong(-1)) return Validity.INVALID;
        JsonNode buddy = (JsonNode) head[1];
        JsonNode permission = buddy.get("permissionVersion");
        if (!(permission == null ? NullNode.instance : permission).equals(p.path("expectedPermissionVersion"))
                || !Buddy.engaged(buddy)) {
            return Validity.INVALID;
        }
        Long maxActive = maxActive(scope, p.path("policyVersion").asText());
        if (maxActive == null) return Validity.UNAVAILABLE;
        if (Holds.employee(c, x, h.employeeId(), h.slotId()).occupying() - 1 >= maxActive) return Validity.INVALID;

        JsonNode account = Sql.one(c, "SELECT record::text FROM employee_account_records WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", rs -> Sql.json(rs.getString(1)), x.environmentId(), x.runId(),
                h.employeeId());
        EligibleCandidates.Result result;
        try {
            result = candidates.evaluate(new EligibleCandidates.Request(x.environmentId(), x.runId(), scope.policyVersion(),
                    now, scope.clockVersion(), new EligibleCandidates.Subject(h.employeeId(), h.slotId(), (Long) employee[0],
                            (JsonNode) employee[1], account == null ? NullNode.instance : account, (Long) head[0],
                            (JsonNode) head[2]),
                    List.of(new EligibleCandidates.Car(h.orderUuid(), rows.car().configurationId(), rows.car().version(),
                            rows.car().attributes()))));
        } catch (RuntimeException e) {
            return Validity.UNAVAILABLE;
        }
        if (!(result instanceof EligibleCandidates.Evaluated evaluated)) return Validity.UNAVAILABLE;
        for (EligibleCandidates.Decision d : evaluated.decisions()) {
            if (!h.orderUuid().equals(d.orderUuid())) continue;
            boolean same = d.quote() != null && Canonical.digest(d.quote().path("terms"))
                    .equals(Canonical.digest(((JsonNode) quote[1]).path("terms")));
            return "eligible".equals(d.gateStatus()) && same ? Validity.VALID : Validity.INVALID;
        }
        return Validity.INVALID;
    }

    private Long maxActive(AllocationScope scope, String policyVersion) {
        try {
            PolicyResult r = policy.getAssumption("hold.employee.maxActive",
                    new PolicyRead(scope.runId(), PolicyClock.iso(scope.now()), policyVersion));
            JsonNode v = r.ok() && policyVersion.equals(r.policyVersion()) && r.value() != null ? r.value().path("value") : null;
            return v != null && v.isIntegralNumber() && v.canConvertToLong() && v.longValue() > 0 ? v.longValue() : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Pend lock(Connection c, RunContext x, String operationId) throws SQLException {
        return pend(c, x, operationId, " FOR UPDATE");
    }

    private static Pend pend(Connection c, RunContext x, String operationId) throws SQLException {
        return pend(c, x, operationId, "");
    }

    private static Pend pend(Connection c, RunContext x, String operationId, String lock) throws SQLException {
        return Sql.one(c, "SELECT state, attempts, version, outcome::text FROM pending_operations "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND operation_type IN "
                + "('buddy-claim', 'buddy-release')" + lock, rs -> new Pend(rs.getString(1), rs.getInt(2), rs.getLong(3),
                        Sql.json(rs.getString(4))), x.environmentId(), x.runId(), operationId);
    }

    /** The committed (or replayed) result, or the typed reason the step did not commit. */
    private static JsonNode answer(Outcome o) {
        if (o instanceof Outcome.Committed committed) return committed.result();
        if (o instanceof Outcome.Refused r) return refusedJson(r.code());
        if (o instanceof Outcome.Conflict c && "stale-version".equals(c.code())) return pendingJson("operation-moved", UNKNOWN);
        return pendingJson(o.code(), UNKNOWN);
    }

    private static ObjectNode settledJson(String state, JsonNode outcome) {
        ObjectNode o = Sql.JSON.createObjectNode().put("kind", "settled").put("state", state);
        o.set("outcome", outcome == null ? NullNode.instance : outcome);
        return o;
    }

    private static ObjectNode pendingJson(String code, String lastKnownState) {
        return Sql.JSON.createObjectNode().put("kind", "pending").put("code", code).put("lastKnownState", lastKnownState);
    }

    private static ObjectNode refusedJson(String code) {
        return Sql.JSON.createObjectNode().put("kind", "refused").put("code", code);
    }

    private static DriveResult decode(JsonNode n) {
        return switch (n.path("kind").asText()) {
            case "settled" -> new DriveResult.Settled(n.path("state").asText(), n.path("outcome"));
            case "refused" -> new DriveResult.Refused(n.path("code").asText());
            case "pending" -> new DriveResult.Pending(n.path("code").asText(), n.path("lastKnownState").asText(UNKNOWN));
            default -> new DriveResult.Pending("operation-moved", UNKNOWN);
        };
    }
}
