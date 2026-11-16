package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.DriveResult;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * FUCQ-467 remote offer decline: persist the intent and its custody first, call the remote outside any
 * transaction, then finalize once on a matching confirmation. Anything else keeps the hold release-pending.
 */
final class RemoteOfferDecisions {

    static final String DECLINE = "offer-decline-release";
    static final String SELECTION = "offer-selection";
    private static final String ACTOR = "system:offer-decisions";
    private static final String UNKNOWN = "unknown";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private record Pend(String state, int attempts, long version, JsonNode outcome) {
        boolean open() {
            return "intent".equals(state) || "pending".equals(state);
        }

        String lastKnown() {
            return outcome == null ? UNKNOWN : outcome.path("lastKnownState").asText(UNKNOWN);
        }
    }

    private record Rows(String type, JsonNode payload, String holdState, String holdOperationId, long holdVersion,
            String offerState, long offerVersion, String carState, long carVersion, boolean otherOccupant) {
        boolean aligned() {
            return "release-pending".equals(holdState) && payload.path("operationId").asText().equals(holdOperationId)
                    && holdVersion == payload.path("expectedHoldVersion").asLong(-1)
                    && "release-pending".equals(offerState) && offerVersion == payload.path("expectedOfferVersion").asLong(-1)
                    && "released".equals(carState) && carVersion == payload.path("expectedStockVersion").asLong(-1)
                    && !otherOccupant;
        }
    }

    private final DataSource dataSource;
    private final RemoteBuddy remote;
    private final OfferDecisions decisions;

    RemoteOfferDecisions(DataSource dataSource, RemoteBuddy remote, OfferDecisions decisions) {
        this.dataSource = dataSource;
        this.remote = remote;
        this.decisions = decisions;
    }

    static String operationId(String runId, String offerId) {
        return "offer-op:" + Canonical.digest(F.arrayNode().add(runId).add(offerId).add(DECLINE));
    }

    /** The intent commits first; the answer is always the stored pending receipt, whatever the inline drive finds. */
    OfferOutcome decline(Principal p, String offerId, ObjectNode input, String commandId, String digest,
            String reasonCode, long expectedOffer, long expectedHold, Instant now) {
        RunContext ctx = new RunContext(p.environmentId(), p.runId(), "employee:" + p.employeeId());
        TransactionRunner runner = new TransactionRunner(dataSource);
        Command command = new Command("offer.decide", "offer-decision:" + offerId + ":" + commandId, input);
        OfferDecisions.Verdict refusal = new OfferDecisions.Verdict();
        Supplier<Outcome> attempt = () -> runner.execute(ctx, command,
                tx -> intent(tx, p, offerId, commandId, digest, reasonCode, expectedOffer, expectedHold, now, refusal));
        Outcome o = settle(runner, ctx, command.commandId(), attempt);
        if (o instanceof Outcome.Committed c) return answered(p, c);
        OfferOutcome mapped = OfferDecisions.map(o, refusal);
        if ("offer-no-longer-pending".equals(mapped.code()) && attempt.get() instanceof Outcome.Committed c) {
            // A concurrent identical command may have committed the intent while this one waited on the lock.
            return answered(p, c);
        }
        return mapped;
    }

    private OfferOutcome answered(Principal p, Outcome.Committed c) {
        if (!c.replayed()) {
            try {
                drive(new RunContext(p.environmentId(), p.runId(), ACTOR), c.result().path("operationId").asText());
            } catch (RuntimeException e) {
                // The pending receipt stands; the tick drives it again.
            }
        }
        ObjectNode copy = c.result().deepCopy();
        if (c.replayed()) copy.put("replayed", true);
        return OfferOutcome.pending(copy);
    }

    private WorkResult intent(Tx tx, Principal p, String offerId, String commandId, String digest, String reasonCode,
            long expectedOffer, long expectedHold, Instant now, OfferDecisions.Verdict refusal) throws SQLException {
        OfferDecisions.Prepared d = decisions.prepare(tx, p, offerId, reasonCode, expectedOffer, expectedHold, now, refusal,
                true);
        if (d == null) return WorkResult.refuse(refusal.outcome.code(), refusal.outcome.reason());
        OfferDecisions.Locked l = d.locked();
        OfferDecisions.Offer offer = l.offer();
        OfferDecisions.Hold hold = l.hold();
        String env = p.environmentId();
        String run = p.runId();
        String holdId = l.holdId();
        String nowText = PolicyClock.iso(now);
        String operationId = operationId(run, offerId);
        String decisionId = OfferDecisions.decisionId(run, offerId);

        tx.cas("UPDATE custody_holds SET state = 'release-pending', operation_id = ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'active'", operationId, env, run, holdId, hold.version());
        tx.cas("UPDATE buddy_offers SET state = 'release-pending', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'active'",
                env, run, offerId, offer.version());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", env, run, offer.orderUuid(), l.car().version());

        ObjectNode payload = F.objectNode();
        payload.put("operationId", operationId).put("offerId", offerId).put("holdId", holdId)
                .put("orderUuid", offer.orderUuid()).put("employeeId", offer.employeeId())
                .put("slotId", hold.slotId()).put("commandId", commandId).put("inputDigest", digest)
                .put("decisionId", decisionId).put("reasonCode", reasonCode);
        payload.set("reason", OfferDecisions.reasonRecord(d.reason(), reasonCode, p.policyVersion()));
        payload.set("exclusion", d.exclusion());
        payload.put("briefVersion", offer.briefVersion()).put("policyVersion", p.policyVersion())
                .put("sourceClaimOperationId", hold.operationId()).put("decidedAt", nowText);
        payload.putObject("priorVersions").put("offer", offer.version()).put("hold", hold.version())
                .put("car", l.car().version());
        payload.put("expectedOfferVersion", offer.version() + 1).put("expectedHoldVersion", hold.version() + 1)
                .put("expectedStockVersion", l.car().version() + 1);

        PendingOperations.recordIntent(tx, operationId, DECLINE, offerId + ":" + DECLINE, payload);
        tx.write("INSERT INTO offer_decision_operations (environment_id, run_id, operation_id, operation_type, offer_id, "
                + "hold_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)", env, run, operationId, DECLINE, offerId, holdId, payload);

        ObjectNode receipt = F.objectNode();
        receipt.put("schemaVersion", 1).put("offerId", offerId).put("decisionId", decisionId)
                .put("commandId", commandId).put("decision", "decline").put("state", "pending")
                .put("reason", "release-pending").put("operationId", operationId)
                .put("offerVersion", offer.version() + 1).put("holdVersion", hold.version() + 1)
                .put("decidedAt", nowText);
        receipt.putArray("availableActions");
        receipt.put("reconciliationRequired", true);
        return WorkResult.ok(receipt);
    }

    /** Drives every open remote offer decision of the run in operation id order: the restart and tick path. */
    ReconcileResult reconcile(String environmentId, String runId, int limit) {
        RunContext ctx = new RunContext(environmentId, runId, ACTOR);
        int driven = 0;
        int settled = 0;
        int pending = 0;
        int refused = 0;
        String firstPending = null;
        String after = "";
        while (true) {
            List<String> page = new ArrayList<>();
            try (Connection c = dataSource.getConnection();
                    var ps = c.prepareStatement("SELECT operation_id FROM pending_operations WHERE environment_id = ? "
                            + "AND run_id = ? AND operation_type IN ('" + SELECTION + "', '" + DECLINE + "') "
                            + "AND state IN ('intent', 'pending') AND operation_id > ? ORDER BY operation_id LIMIT ?")) {
                ps.setString(1, environmentId);
                ps.setString(2, runId);
                ps.setString(3, after);
                ps.setInt(4, limit);
                try (var rs = ps.executeQuery()) {
                    while (rs.next()) page.add(rs.getString(1));
                }
            } catch (SQLException e) {
                return new ReconcileResult(driven, settled, pending + 1, refused, firstPending);
            }
            for (String id : page) {
                DriveResult r = drive(ctx, id);
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
            if (page.size() < limit) break;
            after = page.get(page.size() - 1);
        }
        return new ReconcileResult(driven, settled, pending, refused, firstPending);
    }

    /** One drive: attempt, remote call outside any transaction, acknowledgement; a not-found after reconcile retries once. */
    DriveResult drive(RunContext ctx, String operationId) {
        if (operationId == null || operationId.isBlank()) return new DriveResult.Refused("operation-not-found");
        if (!"remote".equals(remote.mode())) return new DriveResult.Refused("offer-remote-unavailable");
        TransactionRunner runner = new TransactionRunner(dataSource);
        try {
            JsonNode first = attempt(ctx, runner, operationId);
            JsonNode last = "retry".equals(first.path("kind").asText()) ? attempt(ctx, runner, operationId) : first;
            return decode(last);
        } catch (SQLException e) {
            return new DriveResult.Pending("database-unavailable", UNKNOWN);
        }
    }

    private JsonNode attempt(RunContext ctx, TransactionRunner runner, String operationId) throws SQLException {
        Object[] seen;
        try (Connection c = dataSource.getConnection()) {
            seen = typeAndPend(c, ctx, operationId);
        }
        if (seen == null) return refusedJson("operation-not-found");
        if (!DECLINE.equals(seen[0])) return refusedJson("offer-operation-unsupported");
        Pend pend = (Pend) seen[1];
        if (!pend.open()) return settledJson(pend.state(), pend.outcome());
        int next = pend.attempts() + 1;
        // A per-call nonce keeps two racing drivers from replaying one receipt and both calling the remote.
        String call = operationId + ":" + UUID.randomUUID();
        Command attempt = new Command("offer.decision-attempt", call + ":attempt:" + next,
                F.objectNode().put("operationId", operationId).put("attempt", next));
        Outcome o = settle(runner, ctx, attempt.commandId(), () -> runner.execute(ctx, attempt,
                tx -> attemptWork(tx, operationId, pend.attempts())));
        JsonNode prepared = answer(o);
        if (!"attempt".equals(prepared.path("kind").asText())) return prepared;

        JsonNode payload = prepared.path("payload");
        RemoteBuddy.RemoteOperation op = new RemoteBuddy.RemoteOperation(operationId, DECLINE, ctx.runId(),
                payload.path("holdId").asText(), payload.path("orderUuid").asText(), payload.path("employeeId").asText(),
                payload, prepared.path("attempts").asInt());
        String method = prepared.path("method").asText();
        RemoteBuddy.Ack ack = null;
        try {
            ack = "execute".equals(method) ? remote.execute(op) : remote.reconcile(op);
        } catch (Exception e) {
            // A lost or failed call is an unknown answer; the provider's text is never kept.
        }
        RemoteBuddy.Ack received = ack;
        long version = prepared.path("version").asLong();
        Command ackCommand = new Command("offer.decision-ack", call + ":ack:" + op.attempts(),
                F.objectNode().put("operationId", operationId).put("attempt", op.attempts()));
        Outcome done = settle(runner, ctx, ackCommand.commandId(), () -> runner.execute(ctx, ackCommand,
                tx -> ackWork(tx, operationId, version, method, received)));
        return answer(done);
    }

    private static WorkResult attemptWork(Tx tx, String operationId, int expectedAttempts) throws SQLException {
        RunContext x = tx.context();
        Pend p = pend(tx.connection(), x, operationId, " FOR UPDATE");
        if (p == null) return WorkResult.refuse("operation-not-found", "No such operation.");
        if (!p.open()) return WorkResult.ok(settledJson(p.state(), p.outcome()));
        if (p.attempts() != expectedAttempts) return WorkResult.ok(pendingJson("operation-moved", p.lastKnown()));
        Rows rows = load(tx.connection(), x, operationId);
        if (rows == null || !rows.aligned()) {
            return WorkResult.ok(pendingJson("authority-reconciliation-required", p.lastKnown()));
        }
        String method = p.attempts() == 0 || "not-found".equals(p.lastKnown()) ? "execute" : "reconcile";
        ObjectNode outcome = F.objectNode().put("lastKnownState", "release-pending").put("method", method);
        tx.cas("UPDATE pending_operations SET state = 'pending', attempts = attempts + 1, outcome = ?, "
                + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? AND operation_id = ? "
                + "AND version = ? AND state IN ('intent', 'pending')", outcome, x.environmentId(), x.runId(),
                operationId, p.version());
        ObjectNode out = F.objectNode().put("kind", "attempt").put("method", method)
                .put("attempts", p.attempts() + 1).put("version", p.version() + 1);
        out.set("payload", rows.payload());
        return WorkResult.ok(out);
    }

    private static WorkResult ackWork(Tx tx, String operationId, long version, String method, RemoteBuddy.Ack ack)
            throws SQLException {
        RunContext x = tx.context();
        Pend p = pend(tx.connection(), x, operationId, " FOR UPDATE");
        if (p == null) return WorkResult.refuse("operation-not-found", "No such operation.");
        if (!p.open()) return WorkResult.ok(settledJson(p.state(), p.outcome()));
        if (p.version() != version || !"pending".equals(p.state())) {
            return WorkResult.ok(pendingJson("operation-moved", p.lastKnown()));
        }
        Rows rows = load(tx.connection(), x, operationId);
        if (rows == null || !rows.aligned()) {
            return WorkResult.ok(pendingJson("authority-reconciliation-required", p.lastKnown()));
        }
        boolean matched = ack != null && ("confirmed".equals(ack.status()) || "rejected".equals(ack.status())
                || "not-found".equals(ack.status())) && operationId.equals(ack.operationId())
                && x.runId().equals(ack.runId()) && rows.payload().path("orderUuid").asText().equals(ack.orderUuid());
        if (!matched) return remember(tx, operationId, p, method, UNKNOWN, "remote-unconfirmed");
        if ("rejected".equals(ack.status())) return remember(tx, operationId, p, method, "rejected", "release-rejected");
        if ("not-found".equals(ack.status())) {
            // Only an authoritative reconcile absence permits another execute.
            if (!"reconcile".equals(method)) return remember(tx, operationId, p, method, UNKNOWN, "remote-not-found");
            setLastKnown(tx, operationId, p, method, "not-found");
            return WorkResult.ok(F.objectNode().put("kind", "retry"));
        }
        return finalizeDecline(tx, operationId, p, rows.payload());
    }

    /** Confirmed release: hold, offer, car, the one decision row, the event and the operation close in one transaction. */
    private static WorkResult finalizeDecline(Tx tx, String operationId, Pend p, JsonNode pl) throws SQLException {
        RunContext x = tx.context();
        String env = x.environmentId();
        String run = x.runId();
        String offerId = pl.path("offerId").asText();
        String holdId = pl.path("holdId").asText();
        String decidedText = pl.path("decidedAt").asText();
        long offerVersion = pl.path("expectedOfferVersion").asLong();
        long holdVersion = pl.path("expectedHoldVersion").asLong();
        ObjectNode patch = F.objectNode().put("releaseReason", "offer-declined").put("releasedAt", decidedText);
        tx.cas("UPDATE custody_holds SET state = 'released', attributes = attributes || ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'release-pending'", patch, env, run, holdId, holdVersion);
        tx.cas("UPDATE buddy_offers SET state = 'declined', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'release-pending'",
                env, run, offerId, offerVersion);
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", env, run, pl.path("orderUuid").asText(),
                pl.path("expectedStockVersion").asLong());

        String reasonCode = pl.path("reasonCode").asText();
        String decisionId = pl.path("decisionId").asText();
        ObjectNode value = OfferDecisions.declinedValue(offerId, decisionId, pl.path("commandId").asText(), reasonCode,
                offerVersion + 1, holdVersion + 1, decidedText);
        ObjectNode versions = pl.path("priorVersions").deepCopy();
        versions.put("policy", pl.path("policyVersion").asText());
        versions.put("briefVersion", pl.path("briefVersion").asLong());
        versions.put("operationId", operationId);
        tx.write("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, "
                + "employee_id, hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'decline', ?, ?, ?, ?, ?)", env, run, offerId, decisionId,
                pl.path("commandId").asText(), pl.path("inputDigest").asText(), pl.path("employeeId").asText(), holdId,
                reasonCode, pl.path("reason"), versions, value, Instant.parse(decidedText));
        tx.emit("offer-declined:" + holdId, "offer-declined", OfferDecisions.declinedEvent(holdId,
                pl.path("orderUuid").asText(), offerId, pl.path("employeeId").asText(), decisionId, reasonCode,
                pl.path("briefVersion").asLong(), pl.path("policyVersion").asText(), decidedText, pl.path("exclusion")));

        ObjectNode out = F.objectNode().put("state", "declined").put("offerId", offerId).put("holdId", holdId)
                .put("decisionId", decisionId);
        tx.cas("UPDATE pending_operations SET state = 'acknowledged', outcome = ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? "
                + "AND state IN ('intent', 'pending')", out, env, run, operationId, p.version());
        return WorkResult.ok(settledJson("acknowledged", out));
    }

    /** An unanswered, refused or mismatched call: the operation stays pending and custody and exclusion are kept. */
    private static WorkResult remember(Tx tx, String operationId, Pend p, String method, String lastKnown, String code)
            throws SQLException {
        setLastKnown(tx, operationId, p, method, lastKnown);
        return WorkResult.ok(pendingJson(code, lastKnown));
    }

    private static void setLastKnown(Tx tx, String operationId, Pend p, String method, String lastKnown)
            throws SQLException {
        RunContext x = tx.context();
        ObjectNode outcome = F.objectNode().put("lastKnownState", lastKnown).put("method", method);
        tx.cas("UPDATE pending_operations SET outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? AND state = 'pending'",
                outcome, x.environmentId(), x.runId(), operationId, p.version());
    }

    private static Rows load(Connection c, RunContext x, String operationId) throws SQLException {
        Object[] op = OfferDecisions.one(c, "SELECT operation_type, offer_id, hold_id, payload::text "
                + "FROM offer_decision_operations WHERE environment_id = ? AND run_id = ? AND operation_id = ?",
                rs -> new Object[] {rs.getString(1), rs.getString(2), rs.getString(3), OfferDecisions.json(rs.getString(4))},
                x.environmentId(), x.runId(), operationId);
        if (op == null) return null;
        JsonNode pl = (JsonNode) op[3];
        String holdId = (String) op[2];
        Object[] hold = OfferDecisions.one(c, "SELECT state, operation_id, version, order_uuid FROM custody_holds "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ?",
                rs -> new Object[] {rs.getString(1), rs.getString(2), rs.getLong(3), rs.getString(4)},
                x.environmentId(), x.runId(), holdId);
        Object[] offer = OfferDecisions.one(c, "SELECT state, version FROM buddy_offers WHERE environment_id = ? "
                + "AND run_id = ? AND offer_id = ?", rs -> new Object[] {rs.getString(1), rs.getLong(2)},
                x.environmentId(), x.runId(), op[1]);
        if (hold == null || offer == null || !hold[3].equals(pl.path("orderUuid").asText())
                || !holdId.equals(pl.path("holdId").asText()) || !op[1].equals(pl.path("offerId").asText())) {
            return null;
        }
        Object[] car = OfferDecisions.one(c, "SELECT state, version FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", rs -> new Object[] {rs.getString(1), rs.getLong(2)}, x.environmentId(), x.runId(),
                hold[3]);
        if (car == null) return null;
        boolean other = OfferDecisions.one(c, "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND hold_id <> ? AND (state IN " + OfferDecisions.OCCUPYING
                + " OR state = 'allocated') LIMIT 1", rs -> 1, x.environmentId(), x.runId(), hold[3], holdId) != null;
        return new Rows((String) op[0], pl, (String) hold[0], (String) hold[1], (Long) hold[2], (String) offer[0],
                (Long) offer[1], (String) car[0], (Long) car[1], other);
    }

    private static Object[] typeAndPend(Connection c, RunContext x, String operationId) throws SQLException {
        Pend p = pend(c, x, operationId, "");
        if (p == null) return null;
        String type = OfferDecisions.one(c, "SELECT operation_type FROM pending_operations WHERE environment_id = ? "
                + "AND run_id = ? AND operation_id = ?", rs -> rs.getString(1), x.environmentId(), x.runId(), operationId);
        return new Object[] {type, p};
    }

    private static Pend pend(Connection c, RunContext x, String operationId, String lock) throws SQLException {
        return OfferDecisions.one(c, "SELECT state, attempts, version, outcome::text FROM pending_operations "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND operation_type IN ('" + SELECTION
                + "', '" + DECLINE + "')" + lock, rs -> new Pend(rs.getString(1), rs.getInt(2), rs.getLong(3),
                        OfferDecisions.json(rs.getString(4))), x.environmentId(), x.runId(), operationId);
    }

    /** Runs a command; an uncertain commit is inspected, never assumed (absent is retried once). */
    private static Outcome settle(TransactionRunner runner, RunContext ctx, String commandId, Supplier<Outcome> attempt) {
        Outcome o = attempt.get();
        for (int retries = 0; o instanceof Outcome.Uncertain; retries++) {
            Inspection seen = runner.inspect(ctx, commandId);
            if (seen instanceof Inspection.Committed committed) {
                return new Outcome.Committed(committed.result(), committed.runRevision(), true, false);
            }
            if (seen instanceof Inspection.Unavailable || retries >= 1) return o;
            o = attempt.get();
        }
        return o;
    }

    private static JsonNode answer(Outcome o) {
        if (o instanceof Outcome.Committed committed) return committed.result();
        if (o instanceof Outcome.Refused r) return refusedJson(r.code());
        if (o instanceof Outcome.Conflict c && "stale-version".equals(c.code())) return pendingJson("operation-moved", UNKNOWN);
        return pendingJson(o.code(), UNKNOWN);
    }

    private static ObjectNode settledJson(String state, JsonNode outcome) {
        ObjectNode o = F.objectNode().put("kind", "settled").put("state", state);
        o.set("outcome", outcome == null ? NullNode.instance : outcome);
        return o;
    }

    private static ObjectNode pendingJson(String code, String lastKnownState) {
        return F.objectNode().put("kind", "pending").put("code", code).put("lastKnownState", lastKnownState);
    }

    private static ObjectNode refusedJson(String code) {
        return F.objectNode().put("kind", "refused").put("code", code);
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
