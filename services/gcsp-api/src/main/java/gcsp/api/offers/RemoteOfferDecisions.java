package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.DriveResult;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.Principal;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.Work;
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

    record Pend(String state, int attempts, long version, JsonNode outcome) {
        boolean open() {
            return "intent".equals(state) || "pending".equals(state);
        }

        String lastKnown() {
            return outcome == null ? UNKNOWN : outcome.path("lastKnownState").asText(UNKNOWN);
        }
    }

    record Rows(String type, JsonNode payload, String holdState, String holdOperationId, long holdVersion,
            String offerState, long offerVersion, String carState, long carVersion, boolean otherOccupant) {
        boolean selection() {
            return SELECTION.equals(type);
        }

        boolean aligned() {
            return (selection() ? "selection-pending" : "release-pending").equals(holdState)
                    && payload.path("operationId").asText().equals(holdOperationId)
                    && holdVersion == payload.path("expectedHoldVersion").asLong(-1)
                    && (selection() ? "decision-pending" : "release-pending").equals(offerState)
                    && offerVersion == payload.path("expectedOfferVersion").asLong(-1)
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

    /** One selection intent per command: a refused selection restores the offer, so a new command needs a new operation. */
    static String selectionId(String runId, String offerId, String commandId) {
        return "offer-op:" + Canonical.digest(F.arrayNode().add(runId).add(offerId).add(SELECTION).add(commandId));
    }

    /** The intent commits first; the answer is always the stored pending receipt, whatever the inline drive finds. */
    OfferOutcome decline(Principal p, String offerId, ObjectNode input, String commandId, String digest,
            String reasonCode, long expectedOffer, long expectedHold, Instant now) {
        OfferDecisions.Verdict refusal = new OfferDecisions.Verdict();
        return decide(p, offerId, input, commandId, refusal,
                tx -> intent(tx, p, offerId, commandId, digest, reasonCode, expectedOffer, expectedHold, now, refusal));
    }

    /** Remote accept: precheck what ordering will need, then persist the selection intent; the drive converts on confirmation. */
    OfferOutcome accept(Principal p, String offerId, ObjectNode input, String commandId, String digest, long expectedOffer,
            long expectedHold, Instant now) throws SQLException {
        OrderingService service = decisions.orderingService().orElse(null);
        if (service == null) return OfferDecisions.unavailable();
        Object[] row;
        try (Connection c = dataSource.getConnection()) {
            row = OfferDecisions.one(c, "SELECT h.slot_id, k.version, o.brief_version, o.quote_id, h.hold_id, o.state FROM buddy_offers o "
                    + "JOIN custody_holds h ON h.environment_id = o.environment_id AND h.run_id = o.run_id "
                    + "AND h.hold_id = o.hold_id JOIN stock_cars k ON k.environment_id = o.environment_id "
                    + "AND k.run_id = o.run_id AND k.order_uuid = o.order_uuid WHERE o.environment_id = ? "
                    + "AND o.run_id = ? AND o.offer_id = ?",
                    rs -> new Object[] {rs.getString(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5),
                            rs.getString(6)}, p.environmentId(), p.runId(), offerId);
        }
        if (row == null) return OfferOutcome.notFound();
        if (!"active".equals(row[5])) {
            // Not actionable: the locked recheck gives the exact answer (or the stored receipt on a replay).
            OfferDecisions.Verdict settled = new OfferDecisions.Verdict();
            return decide(p, offerId, input, commandId, settled, tx -> {
                OfferDecisions.Locked l = decisions.lock(tx, p, offerId, expectedOffer, expectedHold, null, now, settled, true);
                return l == null ? WorkResult.refuse(settled.outcome.code(), settled.outcome.reason())
                        : WorkResult.refuse("stale-version", "The offer changed.");
            });
        }
        String slotId = (String) row[0];
        long carVersion = (Long) row[1];
        long brief = (Long) row[2];
        String quoteId = (String) row[3];
        String holdId = (String) row[4];
        Long mileage = input.path("expectedReturnMileage").isIntegralNumber() ? input.get("expectedReturnMileage").longValue()
                : null;
        // The ordering intent is submitted after the hold and car versions bump once, so it names the post-intent versions.
        ObjectNode ordering = orderingInput(commandId, offerId, holdId, expectedHold + 1, brief, quoteId, carVersion + 1,
                input.get("termsDigest"), input.get("declarations"));
        OrderingScope scope = new OrderingScope(p.environmentId(), p.runId(), p.employeeId(), slotId, p.policyVersion());
        OfferDecisions.Verdict verdict = new OfferDecisions.Verdict();
        BuddyOfferConversion converter = new BuddyOfferConversion(decisions, verdict,
                new BuddyOfferConversion.Ask(p, offerId, commandId, digest, expectedOffer, mileage));
        OrderingResult checked = service.precheck(scope, ordering, converter);
        if (!(checked instanceof OrderingResult.Ok)) {
            // A stored receipt still answers a replay before this refusal is reached.
            if (verdict.outcome == null) {
                verdict.outcome = checked instanceof OrderingResult.Refused r ? OfferDecisions.refused(r)
                        : OfferOutcome.of(503, "unavailable", checked instanceof OrderingResult.Unavailable u ? u.code()
                                : "offer-decision-unavailable", "Ordering is unavailable right now. Try again shortly.", true);
            }
            OfferOutcome refusal = verdict.outcome;
            return decide(p, offerId, input, commandId, verdict, tx -> WorkResult.refuse(refusal.code(), refusal.reason()));
        }
        OfferDecisions.Verdict intentVerdict = new OfferDecisions.Verdict();
        BuddyOfferConversion revalidator = new BuddyOfferConversion(decisions, intentVerdict,
                new BuddyOfferConversion.Ask(p, offerId, commandId, digest, expectedOffer, mileage));
        return decide(p, offerId, input, commandId, intentVerdict, tx -> selectionIntent(tx, p, offerId, commandId, digest,
                expectedOffer, expectedHold, now, intentVerdict, revalidator, scope, ordering, mileage, carVersion, brief,
                quoteId));
    }

    private static ObjectNode orderingInput(String commandId, String offerId, String holdId, long holdVersion, long brief,
            String quoteId, long stockVersion, JsonNode termsDigest, JsonNode declarations) {
        ObjectNode in = F.objectNode();
        in.put("commandId", "selection-offer:" + Canonical.digest(F.arrayNode().add(offerId).add(commandId)));
        in.putObject("source").put("type", "buddy-offer").put("holdId", holdId).put("expectedHoldVersion", holdVersion)
                .put("expectedDraftVersion", brief);
        in.put("expectedQuoteId", quoteId);
        in.put("expectedStockVersion", stockVersion);
        in.set("termsDigest", termsDigest);
        in.set("declarations", declarations);
        return in;
    }

    private WorkResult selectionIntent(Tx tx, Principal p, String offerId, String commandId, String digest,
            long expectedOffer, long expectedHold, Instant now, OfferDecisions.Verdict refusal,
            BuddyOfferConversion revalidator, OrderingScope scope, ObjectNode ordering, Long mileage, long carVersion,
            long brief, String quoteId) throws SQLException {
        OfferDecisions.Locked l = decisions.lock(tx, p, offerId, expectedOffer, expectedHold, carVersion, now, refusal, true);
        if (l == null) return WorkResult.refuse(refusal.outcome.code(), refusal.outcome.reason());
        OfferDecisions.Offer offer = l.offer();
        OfferDecisions.Hold hold = l.hold();
        if (!l.holdId().equals(ordering.path("source").path("holdId").asText()) || !hold.slotId().equals(scope.entitlementSlotId())
                || offer.briefVersion() != brief || !offer.quoteId().equals(quoteId)
                || !l.car().attributes().path("orderNumber").asText("").matches("\\d{7}")) {
            refusal.outcome = OfferDecisions.authorityChanged();
            return WorkResult.refuse(refusal.outcome.code(), refusal.outcome.reason());
        }
        if (revalidator.revalidate(tx, scope, l, now) != null) {
            return WorkResult.refuse(refusal.outcome.code(), refusal.outcome.reason());
        }
        String env = p.environmentId();
        String run = p.runId();
        String holdId = l.holdId();
        String nowText = PolicyClock.iso(now);
        String operationId = selectionId(run, offerId, commandId);
        String decisionId = OfferDecisions.decisionId(run, offerId);

        tx.cas("UPDATE custody_holds SET state = 'selection-pending', operation_id = ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'active'", operationId, env, run, holdId, hold.version());
        tx.cas("UPDATE buddy_offers SET state = 'decision-pending', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'active'",
                env, run, offerId, offer.version());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", env, run, offer.orderUuid(), l.car().version());

        ObjectNode payload = F.objectNode();
        payload.put("operationId", operationId).put("offerId", offerId).put("holdId", holdId)
                .put("orderUuid", offer.orderUuid()).put("employeeId", offer.employeeId())
                .put("slotId", hold.slotId()).put("commandId", commandId).put("inputDigest", digest)
                .put("decisionId", decisionId).put("quoteId", offer.quoteId()).put("briefVersion", offer.briefVersion())
                .put("policyVersion", p.policyVersion()).put("sourceClaimOperationId", hold.operationId())
                .put("decidedAt", nowText);
        payload.set("ordering", ordering);
        if (mileage == null) payload.putNull("expectedReturnMileage"); else payload.put("expectedReturnMileage", mileage);
        payload.set("allowance", revalidator.allowanceUsed());
        payload.putObject("priorVersions").put("offer", offer.version()).put("hold", hold.version())
                .put("car", l.car().version());
        payload.put("expectedOfferVersion", offer.version() + 1).put("expectedHoldVersion", hold.version() + 1)
                .put("expectedStockVersion", l.car().version() + 1);

        PendingOperations.recordIntent(tx, operationId, SELECTION, offerId + ":" + SELECTION + ":" + commandId, payload);
        tx.write("INSERT INTO offer_decision_operations (environment_id, run_id, operation_id, operation_type, offer_id, "
                + "hold_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)", env, run, operationId, SELECTION, offerId, holdId, payload);

        ObjectNode receipt = F.objectNode();
        receipt.put("schemaVersion", 1).put("offerId", offerId).put("decisionId", decisionId)
                .put("commandId", commandId).put("decision", "accept").put("state", "pending")
                .put("reason", "decision-pending").put("operationId", operationId)
                .put("offerVersion", offer.version() + 1).put("holdVersion", hold.version() + 1)
                .put("decidedAt", nowText);
        receipt.putArray("availableActions");
        receipt.put("reconciliationRequired", true);
        return WorkResult.ok(receipt);
    }

    private OfferOutcome decide(Principal p, String offerId, ObjectNode input, String commandId,
            OfferDecisions.Verdict refusal, Work work) {
        RunContext ctx = new RunContext(p.environmentId(), p.runId(), "employee:" + p.employeeId());
        TransactionRunner runner = new TransactionRunner(dataSource);
        Command command = new Command("offer.decide", "offer-decision:" + offerId + ":" + commandId, input);
        Supplier<Outcome> attempt = () -> runner.execute(ctx, command, work);
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
        return "accept".equals(copy.path("decision").asText()) ? OfferOutcome.pending(copy, "decision-pending")
                : OfferOutcome.pending(copy);
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
        String type = (String) seen[0];
        Pend pend = (Pend) seen[1];
        if (!pend.open()) return settledJson(pend.state(), pend.outcome());
        if (SELECTION.equals(type) && "confirmed".equals(pend.lastKnown())) return convert(ctx, operationId);
        int next = pend.attempts() + 1;
        // A per-call nonce keeps two racing drivers from replaying one receipt and both calling the remote.
        String call = operationId + ":" + UUID.randomUUID();
        Command attempt = new Command("offer.decision-attempt", call + ":attempt:" + next,
                F.objectNode().put("operationId", operationId).put("attempt", next));
        Outcome o = settle(runner, ctx, attempt.commandId(), () -> runner.execute(ctx, attempt,
                tx -> attemptWork(tx, operationId, pend.attempts())));
        JsonNode prepared = answer(o);
        if ("convert".equals(prepared.path("kind").asText())) return convert(ctx, operationId);
        if (!"attempt".equals(prepared.path("kind").asText())) return prepared;

        JsonNode payload = prepared.path("payload");
        RemoteBuddy.RemoteOperation op = new RemoteBuddy.RemoteOperation(operationId, type, ctx.runId(),
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
        JsonNode answered = answer(done);
        return "convert".equals(answered.path("kind").asText()) ? convert(ctx, operationId) : answered;
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
        if (rows.selection() && "confirmed".equals(p.lastKnown())) return WorkResult.ok(F.objectNode().put("kind", "convert"));
        String method = p.attempts() == 0 || "not-found".equals(p.lastKnown()) ? "execute" : "reconcile";
        ObjectNode outcome = F.objectNode().put("lastKnownState", rows.selection() ? "selection-pending" : "release-pending")
                .put("method", method);
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
        if ("rejected".equals(ack.status())) {
            return rows.selection() ? refuseSelection(tx, operationId, p, rows.payload())
                    : remember(tx, operationId, p, method, "rejected", "release-rejected");
        }
        if ("not-found".equals(ack.status())) {
            // Only an authoritative reconcile absence permits another execute.
            if (!"reconcile".equals(method)) return remember(tx, operationId, p, method, UNKNOWN, "remote-not-found");
            setLastKnown(tx, operationId, p, method, "not-found");
            return WorkResult.ok(F.objectNode().put("kind", "retry"));
        }
        if (rows.selection()) {
            setLastKnown(tx, operationId, p, method, "confirmed");
            return WorkResult.ok(F.objectNode().put("kind", "convert"));
        }
        return finalizeDecline(tx, operationId, p, rows.payload());
    }

    /** A definitive selection refusal restores the prior active state and the original deadline; expiry may then act. */
    private static WorkResult refuseSelection(Tx tx, String operationId, Pend p, JsonNode pl) throws SQLException {
        RunContext x = tx.context();
        String env = x.environmentId();
        String run = x.runId();
        String offerId = pl.path("offerId").asText();
        String holdId = pl.path("holdId").asText();
        tx.cas("UPDATE custody_holds SET state = 'active', operation_id = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? AND state = 'selection-pending'",
                pl.path("sourceClaimOperationId").asText(), env, run, holdId, pl.path("expectedHoldVersion").asLong());
        tx.cas("UPDATE buddy_offers SET state = 'active', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'decision-pending'",
                env, run, offerId, pl.path("expectedOfferVersion").asLong());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", env, run, pl.path("orderUuid").asText(),
                pl.path("expectedStockVersion").asLong());
        ObjectNode out = F.objectNode().put("state", "selection-refused").put("offerId", offerId).put("holdId", holdId);
        tx.cas("UPDATE pending_operations SET state = 'refused', outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? "
                + "AND state IN ('intent', 'pending')", out, env, run, operationId, p.version());
        return WorkResult.ok(settledJson("refused", out));
    }

    /** Confirmed selection: ordering takes the intent and the one decision commits with it; any other answer keeps custody. */
    private JsonNode convert(RunContext ctx, String operationId) throws SQLException {
        Rows rows;
        Pend p;
        try (Connection c = dataSource.getConnection()) {
            rows = load(c, ctx, operationId);
        }
        OrderingService service = decisions.orderingService().orElse(null);
        if (rows == null || service == null) return pendingJson("conversion-pending", "confirmed");
        JsonNode pl = rows.payload();
        OrderingScope scope = new OrderingScope(ctx.environmentId(), ctx.runId(), pl.path("employeeId").asText(),
                pl.path("slotId").asText(), pl.path("policyVersion").asText());
        service.submitTrusted(scope, pl.path("ordering"), new RemoteSelectionConversion(decisions, operationId, pl));
        try (Connection c = dataSource.getConnection()) {
            p = pend(c, ctx, operationId, "");
        }
        // Closed means finalized here or by a racing driver; anything else (refused, unavailable) keeps custody.
        return p != null && !p.open() ? settledJson(p.state(), p.outcome()) : pendingJson("conversion-pending", "confirmed");
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

    static Rows load(Connection c, RunContext x, String operationId) throws SQLException {
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

    static Pend pend(Connection c, RunContext x, String operationId, String lock) throws SQLException {
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
