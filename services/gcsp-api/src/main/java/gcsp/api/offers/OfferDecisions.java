package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.Principal;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** FUCQ-466 offer decision: decline rechecks every fact under row locks, then writes all rows and the event in one command. */
@ApplicationScoped
public class OfferDecisions {

    static final String REASONS_KEY = "offer.declineReasons.v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();
    private static final Set<String> KEYS = Set.of("commandId", "decision", "reasonCode", "expectedOfferVersion",
            "expectedHoldVersion", "termsDigest", "declarations", "expectedReturnMileage");
    static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    @Inject
    OfferAccess access;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @Inject
    Instance<RemoteBuddy> remote;

    @Inject
    OrderingServiceHolder orderingHolder;

    @Inject
    Instance<AccountRecordsPort> accountPort;

    private BooleanSupplier active;
    private Supplier<DataSource> source;
    private Supplier<RemoteBuddy> buddy;
    private Supplier<Optional<OrderingService>> ordering;
    private Supplier<AccountRecordsPort> accounts;

    OfferDecisions() {}

    OfferDecisions(BooleanSupplier active, Supplier<DataSource> source, OfferAccess access, PolicyService policy,
            PolicyClock clock, Supplier<RemoteBuddy> buddy) {
        this.active = active;
        this.source = source;
        this.access = access;
        this.policy = policy;
        this.clock = clock;
        this.buddy = buddy;
    }

    OfferDecisions(BooleanSupplier active, Supplier<DataSource> source, OfferAccess access, PolicyService policy,
            PolicyClock clock, Supplier<RemoteBuddy> buddy, Supplier<Optional<OrderingService>> ordering,
            Supplier<AccountRecordsPort> accounts) {
        this(active, source, access, policy, clock, buddy);
        this.ordering = ordering;
        this.accounts = accounts;
    }

    private record Stored(String commandId, String digest, JsonNode outcome, Instant createdAt) {}

    record Offer(String offerId, String holdId, String state, long version, String employeeId, String orderUuid,
            String quoteId, long briefVersion, String policyVersion, String operationId) {}

    record Hold(String state, String type, long version, Instant expiresAt, String orderUuid, String employeeId,
            String slotId, JsonNode attributes, String operationId) {}

    record Car(String state, long version, String configurationId, JsonNode attributes) {}

    record Quote(String orderUuid, String employeeId, String slotId, Instant validUntil, Integer monthlyPoints,
            JsonNode json) {}

    /** The rows of one offer, read under the hold, offer and car row locks and rechecked. */
    record Locked(String holdId, Offer offer, Hold hold, Car car, Quote quote) {}

    /** Carries the typed refusal out of the work callback, which can only roll back with a code. */
    static final class Verdict {
        OfferOutcome outcome;
        boolean converted;
    }

    public OfferOutcome decide(Principal p, String offerId, JsonNode body) {
        if (!valid(body)) return invalid();
        boolean accept = "accept".equals(body.get("decision").textValue());
        long offerVersion = body.get("expectedOfferVersion").longValue();
        long holdVersion = body.get("expectedHoldVersion").longValue();
        String commandId = body.get("commandId").textValue();
        String reasonCode = accept ? null : body.get("reasonCode").textValue();
        OfferAuthority authority = access.authorizeDecision(p, offerId, offerVersion);
        // The two 409s may be a replay of a stored decision; the locked recheck gives the authoritative answer.
        if (authority instanceof OfferAuthority.Refused r && !replayable(r.refusal())) return r.refusal();
        if (!active().getAsBoolean()) return unavailable();
        boolean remoteMode = "remote".equals(buddy().get().mode());
        ObjectNode input = F.objectNode();
        input.put("offerId", offerId);
        input.put("decision", accept ? "accept" : "decline");
        if (accept) {
            input.set("termsDigest", body.get("termsDigest"));
            input.set("declarations", body.get("declarations"));
        } else {
            input.put("reasonCode", reasonCode);
        }
        input.put("expectedOfferVersion", offerVersion);
        input.put("expectedHoldVersion", holdVersion);
        if (accept) {
            if (body.has("expectedReturnMileage")) input.set("expectedReturnMileage", body.get("expectedReturnMileage"));
            else input.putNull("expectedReturnMileage");
        }
        String digest = Canonical.digest(input);
        try {
            if (remoteMode) {
                Instant at = clock.now(context(p));
                if (at == null) return unavailable();
                return accept ? remoteDecisions().accept(p, offerId, input, commandId, digest, offerVersion, holdVersion, at)
                        : remoteDecisions().decline(p, offerId, input, commandId, digest, reasonCode, offerVersion,
                                holdVersion, at);
            }
            Stored prior = stored(p, offerId);
            if (prior != null) return fromStored(prior, commandId, digest);
            Instant now = clock.now(context(p));
            if (now == null) return unavailable();
            if (accept) return accept(p, offerId, body, commandId, digest);
            RunContext ctx = new RunContext(p.environmentId(), p.runId(), "employee:" + p.employeeId());
            Command command = new Command("offer.decide", "offer-decision:" + offerId + ":" + commandId, input);
            Verdict refusal = new Verdict();
            Outcome o = new TransactionRunner(source().get()).execute(ctx, command,
                    tx -> decline(tx, p, offerId, commandId, digest, reasonCode, offerVersion, holdVersion, now, refusal));
            if (o instanceof Outcome.Committed c) return ok(c.result(), c.replayed());
            OfferOutcome mapped = map(o, refusal);
            // A concurrent identical command may have won: answer from the stored decision when there is one.
            Stored after = stored(p, offerId);
            return after != null && !"offer-from-earlier-run".equals(mapped.code()) ? fromStored(after, commandId, digest)
                    : mapped;
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    /** Drives every open remote offer decision of the run (the restart and tick path); zeros outside remote mode. */
    public ReconcileResult reconcileRemote(String environmentId, String runId, int limit) {
        if (!active().getAsBoolean() || !"remote".equals(buddy().get().mode())) return new ReconcileResult(0, 0, 0, 0, null);
        return remoteDecisions().reconcile(environmentId, runId, limit);
    }

    private RemoteOfferDecisions remoteDecisions() {
        return new RemoteOfferDecisions(source().get(), buddy().get(), this);
    }

    /** Accept runs inside ordering's transaction through the Buddy converter, so selection and decision commit as one. */
    private OfferOutcome accept(Principal p, String offerId, JsonNode body, String commandId, String digest)
            throws SQLException {
        OrderingService service = ordering().get().orElse(null);
        if (service == null) return unavailable();
        Object[] row;
        try (Connection c = source().get().getConnection()) {
            row = one(c, "SELECT h.slot_id, k.version, o.brief_version, o.quote_id, h.hold_id FROM buddy_offers o "
                    + "JOIN custody_holds h ON h.environment_id = o.environment_id AND h.run_id = o.run_id "
                    + "AND h.hold_id = o.hold_id JOIN stock_cars k ON k.environment_id = o.environment_id "
                    + "AND k.run_id = o.run_id AND k.order_uuid = o.order_uuid WHERE o.environment_id = ? "
                    + "AND o.run_id = ? AND o.offer_id = ?",
                    rs -> new Object[] {rs.getString(1), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5)},
                    p.environmentId(), p.runId(), offerId);
        }
        if (row == null) return OfferOutcome.notFound();
        long offerVersion = body.get("expectedOfferVersion").longValue();
        long holdVersion = body.get("expectedHoldVersion").longValue();
        OrderingScope scope = new OrderingScope(p.environmentId(), p.runId(), p.employeeId(), (String) row[0],
                p.policyVersion());
        ObjectNode in = F.objectNode();
        in.put("commandId", "selection-offer:" + Canonical.digest(F.arrayNode().add(offerId).add(commandId)));
        in.putObject("source").put("type", "buddy-offer").put("holdId", (String) row[4])
                .put("expectedHoldVersion", holdVersion).put("expectedDraftVersion", (Long) row[2]);
        in.put("expectedQuoteId", (String) row[3]);
        in.put("expectedStockVersion", (Long) row[1]);
        in.set("termsDigest", body.get("termsDigest"));
        in.set("declarations", body.get("declarations"));
        Long mileage = body.has("expectedReturnMileage") ? body.get("expectedReturnMileage").longValue() : null;
        Verdict verdict = new Verdict();
        BuddyOfferConversion converter = new BuddyOfferConversion(this, verdict,
                new BuddyOfferConversion.Ask(p, offerId, commandId, digest, offerVersion, mileage));
        OrderingResult result = service.submitTrusted(scope, in, converter);
        Stored after = stored(p, offerId);
        // A converter refusal rolled everything back and is the exact answer, unless a concurrent command decided first.
        if (verdict.outcome != null) return after == null ? verdict.outcome : fromStored(after, commandId, digest);
        boolean settled = result instanceof OrderingResult.Ok || result instanceof OrderingResult.Pending;
        if (after != null && (!verdict.converted || after.commandId().equals(commandId))) {
            // A converted accept is this command's first answer; otherwise ordering replayed and the stored decision decides.
            OfferOutcome answer = verdict.converted ? ok(after.outcome(), false) : fromStored(after, commandId, digest);
            if (!settled || answer.http() != 200) return answer;
            ObjectNode value = answer.value().deepCopy();
            if (result instanceof OrderingResult.Ok k) value.set("selection", k.value());
            else if (((OrderingResult.Pending) result).value() != null) value.set("selection", ((OrderingResult.Pending) result).value());
            else value.putObject("selection").put("state", "pending").put("operationId", ((OrderingResult.Pending) result).operationId());
            return OfferOutcome.ok(value);
        }
        if (result instanceof OrderingResult.Refused r) return refused(r);
        if (result instanceof OrderingResult.Unavailable u) {
            return OfferOutcome.of(503, "unavailable", u.code(), "Ordering is unavailable right now. Try again shortly.", true);
        }
        return unavailable();
    }

    static OfferOutcome refused(OrderingResult.Refused r) {
        return switch (r.status()) {
            case 400 -> OfferOutcome.invalid("invalid-offer-decision", "Check the terms and declarations and try again.");
            case 403 -> OfferOutcome.forbidden(r.code(), "Sign in as the employee this offer was sent to.");
            case 404 -> OfferOutcome.notFound();
            default -> OfferOutcome.of(409, "conflict", r.code(), "This selection cannot be recorded. Reload your offer.", false);
        };
    }

    public OfferOutcome reasons(Principal p, String offerId) {
        OfferOutcome owned = access.read(p, offerId);
        if (owned.http() != 200) return owned;
        try {
            Instant now = clock.now(context(p));
            JsonNode registry = now == null ? null : registry(p, now);
            if (registry == null) return reasonsUnavailable();
            ObjectNode value = F.objectNode();
            value.put("schemaVersion", 1);
            value.put("policyVersion", p.policyVersion());
            value.put("key", REASONS_KEY);
            value.set("reasons", registry.get("reasons").deepCopy());
            return OfferOutcome.ok(value);
        } catch (RuntimeException e) {
            return reasonsUnavailable();
        }
    }

    public OfferOutcome followUp(Principal p, String offerId) {
        OfferOutcome owned = access.read(p, offerId);
        if (owned.http() != 200) return owned;
        if (!active().getAsBoolean()) return unavailable();
        try (Connection c = source().get().getConnection()) {
            Object[] decision = one(c, "SELECT decision_id, created_at FROM offer_decisions WHERE environment_id = ? "
                    + "AND run_id = ? AND offer_id = ? AND decision = 'decline'",
                    rs -> new Object[] {rs.getString(1), instant(rs, 2)}, p.environmentId(), p.runId(), offerId);
            if (decision == null) {
                return OfferOutcome.of(404, "not-found", "offer-follow-up-not-found",
                        "No decline was recorded for this offer.", false);
            }
            // Offers and decisions both stamp database time, so this stays right under a demo clock.
            String next = one(c, "SELECT offer_id FROM buddy_offers WHERE environment_id = ? AND run_id = ? "
                    + "AND employee_id = ? AND state = 'active' AND created_at > ? ORDER BY created_at, offer_id LIMIT 1",
                    rs -> rs.getString(1), p.environmentId(), p.runId(), p.employeeId(), decision[1]);
            ObjectNode value = F.objectNode();
            value.put("schemaVersion", 1);
            value.put("offerId", offerId);
            value.put("decisionId", (String) decision[0]);
            value.put("state", next == null ? "waiting-for-next-offer" : "next-offer");
            if (next == null) value.putNull("nextOfferId"); else value.put("nextOfferId", next);
            value.put("briefChange", "unavailable");
            return OfferOutcome.ok(value);
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    /** The locked rows, the chosen reason and the exclusion rule: everything a decline needs before it writes. */
    record Prepared(Locked locked, JsonNode reason, JsonNode exclusion) {}

    /** Locked recheck, reason registry and exclusion shared by local decline and the remote intent; null with the refusal set. */
    Prepared prepare(Tx tx, Principal p, String offerId, String reasonCode, long expectedOffer, long expectedHold,
            Instant now, Verdict refusal, boolean remote) throws SQLException {
        Locked l = lock(tx, p, offerId, expectedOffer, expectedHold, null, now, refusal, remote);
        if (l == null) return null;
        JsonNode registry = registry(p, now);
        if (registry == null) return deny(refusal, reasonsUnavailable());
        JsonNode reason = null;
        for (JsonNode r : registry.get("reasons")) if (reasonCode.equals(r.get("code").textValue())) reason = r;
        if (reason == null) return deny(refusal, invalid());
        JsonNode exclusion = exclusion(p, now);
        if (exclusion == null) return deny(refusal, OfferOutcome.of(503, "unavailable", "decline-exclusion-unavailable",
                "The decline rules are unavailable right now. Try again shortly.", false));
        return new Prepared(l, reason, exclusion);
    }

    static String decisionId(String runId, String offerId) {
        return "offer-decision:" + Canonical.digest(F.arrayNode().add(runId).add(offerId));
    }

    static ObjectNode reasonRecord(JsonNode reason, String reasonCode, String policyVersion) {
        ObjectNode stored = F.objectNode();
        stored.put("code", reasonCode);
        stored.put("label", reason.get("label").textValue());
        stored.put("attribute", reason.get("attribute").textValue());
        stored.put("policyVersion", policyVersion);
        return stored;
    }

    static ObjectNode declinedValue(String offerId, String decisionId, String commandId, String reasonCode,
            long offerVersion, long holdVersion, String decidedAt) {
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1);
        value.put("offerId", offerId);
        value.put("decisionId", decisionId);
        value.put("commandId", commandId);
        value.put("decision", "decline");
        value.put("state", "declined");
        value.put("reasonCode", reasonCode);
        value.put("offerVersion", offerVersion);
        value.put("holdVersion", holdVersion);
        value.put("decidedAt", decidedAt);
        value.putArray("availableActions");
        value.putObject("followUp").put("state", "waiting-for-next-offer").put("briefChange", "unavailable");
        return value;
    }

    static ObjectNode declinedEvent(String holdId, String orderUuid, String offerId, String employeeId, String decisionId,
            String reasonCode, long briefVersion, String policyVersion, String occurredAt, JsonNode exclusion) {
        ObjectNode event = F.objectNode();
        event.put("holdId", holdId);
        event.put("orderUuid", orderUuid);
        event.put("offerId", offerId);
        event.put("employeeId", employeeId);
        event.put("decisionId", decisionId);
        event.put("reasonCode", reasonCode);
        event.put("briefVersion", briefVersion);
        event.put("policyVersion", policyVersion);
        event.put("occurredAt", occurredAt);
        event.set("exclusion", exclusion);
        return event;
    }

    private WorkResult decline(Tx tx, Principal p, String offerId, String commandId, String digest, String reasonCode,
            long expectedOffer, long expectedHold, Instant now, Verdict refusal) throws SQLException {
        Prepared d = prepare(tx, p, offerId, reasonCode, expectedOffer, expectedHold, now, refusal, false);
        if (d == null) return WorkResult.refuse(refusal.outcome.code(), refusal.outcome.reason());
        Locked l = d.locked();
        String env = p.environmentId();
        String run = p.runId();
        String holdId = l.holdId();
        Offer offer = l.offer();
        Hold hold = l.hold();
        Car car = l.car();

        String nowText = PolicyClock.iso(now);
        ObjectNode patch = F.objectNode().put("releaseReason", "offer-declined").put("releasedAt", nowText);
        tx.cas("UPDATE custody_holds SET state = 'released', attributes = attributes || ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'active'", patch, env, run, holdId, hold.version());
        tx.cas("UPDATE buddy_offers SET state = 'declined', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'active'",
                env, run, offerId, offer.version());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", env, run, offer.orderUuid(), car.version());

        String decisionId = decisionId(run, offerId);
        ObjectNode value = declinedValue(offerId, decisionId, commandId, reasonCode, offer.version() + 1,
                hold.version() + 1, nowText);
        ObjectNode versions = F.objectNode();
        versions.put("offer", offer.version());
        versions.put("hold", hold.version());
        versions.put("car", car.version());
        versions.put("policy", p.policyVersion());
        versions.put("briefVersion", offer.briefVersion());
        tx.write("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, "
                + "employee_id, hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'decline', ?, ?, ?, ?, ?)", env, run, offerId, decisionId, commandId,
                digest, offer.employeeId(), holdId, reasonCode, reasonRecord(d.reason(), reasonCode, p.policyVersion()),
                versions, value, now);
        tx.emit("offer-declined:" + holdId, "offer-declined", declinedEvent(holdId, offer.orderUuid(), offerId,
                offer.employeeId(), decisionId, reasonCode, offer.briefVersion(), p.policyVersion(), nowText,
                d.exclusion()));
        return WorkResult.ok(value);
    }

    /**
     * Locks hold, offer and car in BuddyExpiry's order, then rechecks ownership, state, identity, versions, deadline
     * and car authority. Returns null with the refusal set when the decision cannot proceed.
     */
    Locked lock(Tx tx, Principal p, String offerId, long expectedOffer, long expectedHold, Long expectedCar, Instant now,
            Verdict refusal) throws SQLException {
        return lock(tx, p, offerId, expectedOffer, expectedHold, expectedCar, now, refusal, false);
    }

    /** As above; remote also requires the hold and offer to come from one acknowledged, offered remote claim. */
    Locked lock(Tx tx, Principal p, String offerId, long expectedOffer, long expectedHold, Long expectedCar, Instant now,
            Verdict refusal, boolean remote) throws SQLException {
        String env = p.environmentId();
        String run = p.runId();
        String holdId = tx.first("SELECT hold_id FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND offer_id = ?",
                rs -> rs.getString(1), env, run, offerId).orElse(null);
        if (holdId == null) return deny(refusal, OfferOutcome.notFound());
        Hold hold = tx.first("SELECT state, hold_type, version, expires_at, order_uuid, employee_id, slot_id, attributes::text, "
                + "operation_id FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id = ? FOR UPDATE",
                rs -> new Hold(rs.getString(1), rs.getString(2), rs.getLong(3), instant(rs, 4), rs.getString(5),
                        rs.getString(6), rs.getString(7), json(rs.getString(8)), rs.getString(9)), env, run, holdId).orElse(null);
        Offer offer = tx.first("SELECT offer_id, hold_id, state, version, employee_id, order_uuid, quote_id, brief_version, "
                + "policy_version, operation_id FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND offer_id = ? FOR UPDATE",
                rs -> new Offer(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5),
                        rs.getString(6), rs.getString(7), rs.getLong(8), rs.getString(9), rs.getString(10)), env, run, offerId)
                .orElse(null);
        if (hold == null || offer == null) return deny(refusal, inconsistent());
        Car car = tx.first("SELECT state, version, configuration_id, attributes::text FROM stock_cars WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ? FOR UPDATE", rs -> new Car(rs.getString(1), rs.getLong(2),
                rs.getString(3), json(rs.getString(4))), env, run, offer.orderUuid()).orElse(null);
        Quote quote = tx.first("SELECT order_uuid, employee_id, slot_id, valid_until, monthly_points, quote::text "
                + "FROM buddy_quotes WHERE environment_id = ? AND run_id = ? AND quote_id = ?",
                rs -> new Quote(rs.getString(1), rs.getString(2), rs.getString(3), instant(rs, 4),
                        (Integer) rs.getObject(5), json(rs.getString(6))), env, run, offer.quoteId()).orElse(null);
        if (!p.employeeId().equals(offer.employeeId())) {
            return deny(refusal, OfferOutcome.forbidden("offer-not-owned", "Sign in as the employee this offer was sent to."));
        }
        if (!"active".equals(offer.state()) || !"active".equals(hold.state()) || !"buddy-offer".equals(hold.type())) {
            return deny(refusal, noLongerPending(offer));
        }
        if (car == null || quote == null || !offer.orderUuid().equals(hold.orderUuid())
                || !offer.orderUuid().equals(quote.orderUuid()) || !offer.employeeId().equals(hold.employeeId())
                || !offer.employeeId().equals(quote.employeeId()) || !hold.slotId().equals(quote.slotId())) {
            return deny(refusal, inconsistent());
        }
        if (remote) {
            if (!remoteClaimOffered(tx, env, run, hold, offer)) return deny(refusal, inconsistent());
        } else if (tx.first("SELECT 1 FROM buddy_operations WHERE environment_id = ? AND run_id = ? AND hold_id = ? LIMIT 1",
                rs -> 1, env, run, holdId).isPresent()) {
            return deny(refusal, remoteRequired());
        }
        if (offer.version() != expectedOffer || hold.version() != expectedHold) {
            return deny(refusal, OfferOutcome.conflict("stale-version", "This offer has changed. Reload it and try again.",
                    "pending", offer.version()));
        }
        if (!inclusive(p, offer, now)) {
            return deny(refusal, OfferOutcome.of(503, "unavailable", "decision-rules-unavailable",
                    "The decision rules are unavailable right now. Try again shortly.", false));
        }
        if (!now.isBefore(hold.expiresAt())) {
            return deny(refusal, OfferOutcome.conflict("deadline-passed", "The time to decide this offer has passed.",
                    "expired", offer.version()));
        }
        boolean otherAuthority = tx.first("SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND hold_id <> ? AND (state IN " + OCCUPYING + " OR state = 'allocated') LIMIT 1",
                rs -> 1, env, run, offer.orderUuid(), holdId).isPresent();
        if (!"released".equals(car.state()) || otherAuthority || expectedCar != null && car.version() != expectedCar) {
            return deny(refusal, authorityChanged());
        }
        return new Locked(holdId, offer, hold, car, quote);
    }

    /** The hold and the offer both name one acknowledged buddy-claim whose outcome is an offer. */
    private static boolean remoteClaimOffered(Tx tx, String env, String run, Hold hold, Offer offer) throws SQLException {
        return hold.operationId() != null && hold.operationId().equals(offer.operationId())
                && tx.first("SELECT 1 FROM pending_operations WHERE environment_id = ? AND run_id = ? AND operation_id = ? "
                        + "AND operation_type = 'buddy-claim' AND state = 'acknowledged' AND outcome->>'state' = 'offered'",
                        rs -> 1, env, run, hold.operationId()).isPresent();
    }

    private static <T> T deny(Verdict refusal, OfferOutcome outcome) {
        refusal.outcome = outcome;
        return null;
    }

    static OfferOutcome authorityChanged() {
        return OfferOutcome.of(409, "conflict", "selection-authority-changed",
                "This car is no longer available to decide. Reload your offers.", false);
    }

    static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text == null ? "{}" : text);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Stored JSON is unreadable");
        }
    }

    /** The deadline rule is inclusive at the offer's own policy version, or the decision is refused. */
    private boolean inclusive(Principal p, Offer offer, Instant now) {
        try {
            PolicyResult r = policy.getAssumption("hold.deadline.inclusive",
                    new PolicyRead(p.runId(), PolicyClock.iso(now), offer.policyVersion()));
            return r.ok() && offer.policyVersion().equals(r.policyVersion()) && r.value() != null
                    && r.value().path("value").isBoolean() && r.value().path("value").booleanValue();
        } catch (RuntimeException e) {
            return false;
        }
    }

    private JsonNode exclusion(Principal p, Instant now) {
        try {
            PolicyResult r = policy.getAssumption("offer.declinedCar.exclusion",
                    new PolicyRead(p.runId(), PolicyClock.iso(now), p.policyVersion()));
            if (!r.ok() || p.policyVersion() == null || !p.policyVersion().equals(r.policyVersion()) || r.value() == null
                    || !"untilRelevantConfirmedBriefChange".equals(r.value().path("value").textValue())) {
                return null;
            }
            return F.objectNode().put("key", "offer.declinedCar.exclusion")
                    .put("value", "untilRelevantConfirmedBriefChange").put("policyVersion", r.policyVersion());
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The registry value at the principal's policy version when it is exactly the documented shape, else null. */
    private JsonNode registry(Principal p, Instant now) {
        if (p.policyVersion() == null) return null;
        PolicyResult r = policy.getAssumption(REASONS_KEY, new PolicyRead(p.runId(), PolicyClock.iso(now), p.policyVersion()));
        if (!r.ok() || !p.policyVersion().equals(r.policyVersion()) || r.value() == null) return null;
        JsonNode v = r.value().get("value");
        if (v == null || !v.isObject() || v.size() != 2 || !v.path("schemaVersion").isIntegralNumber()
                || v.path("schemaVersion").asLong() != 1 || !v.path("reasons").isArray() || v.get("reasons").isEmpty()) {
            return null;
        }
        Set<String> codes = new HashSet<>();
        for (JsonNode reason : v.get("reasons")) {
            if (!reason.isObject() || reason.size() != 3 || !text(reason.get("code")) || !text(reason.get("label"))
                    || !text(reason.get("attribute")) || !codes.add(reason.get("code").textValue())) {
                return null;
            }
        }
        return v;
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() && n.textValue().length() <= 128;
    }

    private static boolean positive(JsonNode n) {
        return n != null && n.isIntegralNumber() && n.canConvertToLong() && n.longValue() > 0;
    }

    private static boolean valid(JsonNode body) {
        if (body == null || !body.isObject()) return false;
        for (String name : (Iterable<String>) body::fieldNames) if (!KEYS.contains(name)) return false;
        if (!text(body.get("commandId")) || !positive(body.get("expectedOfferVersion"))
                || !positive(body.get("expectedHoldVersion"))) {
            return false;
        }
        String decision = body.path("decision").textValue();
        if ("decline".equals(decision)) {
            return text(body.get("reasonCode")) && !body.has("termsDigest") && !body.has("declarations")
                    && !body.has("expectedReturnMileage");
        }
        JsonNode miles = body.get("expectedReturnMileage");
        return "accept".equals(decision) && !body.has("reasonCode") && text(body.get("termsDigest"))
                && body.path("declarations").isObject()
                && (miles == null || miles.isIntegralNumber() && miles.canConvertToLong() && miles.longValue() >= 0
                        && miles.longValue() <= 9007199254740991L);
    }

    private static boolean replayable(OfferOutcome refusal) {
        return refusal.http() == 409 && ("stale-version".equals(refusal.code()) || "offer-not-actionable".equals(refusal.code()));
    }

    private static OfferOutcome fromStored(Stored s, String commandId, String digest) {
        if (s.commandId().equals(commandId)) {
            if (s.digest().equals(digest)) return ok(s.outcome(), true);
            return OfferOutcome.of(409, "conflict", "command-input-changed",
                    "This command id was already used with different details.", false);
        }
        ObjectNode current = F.objectNode();
        current.put("state", s.outcome().path("state").asText("declined"));
        if (s.outcome().path("offerVersion").isIntegralNumber()) {
            current.put("offerVersion", s.outcome().path("offerVersion").asLong());
        }
        return new OfferOutcome(409, "conflict", "offer-no-longer-pending", "This offer has already been decided.", false,
                null, current);
    }

    static OfferOutcome noLongerPending(Offer offer) {
        String state = switch (offer.state()) {
            case "active", "decision-pending", "release-pending" -> "pending";
            default -> offer.state();
        };
        return OfferOutcome.conflict("offer-no-longer-pending", "This offer can no longer be decided.", state,
                offer.version());
    }

    static OfferOutcome map(Outcome o, Verdict refusal) {
        if (o instanceof Outcome.Refused && refusal.outcome != null) return refusal.outcome;
        if (o instanceof Outcome.Conflict c) {
            return switch (c.code()) {
                case "stale-run" -> OfferOutcome.staleRun();
                case "command-input-changed" -> OfferOutcome.of(409, "conflict", "command-input-changed",
                        "This command id was already used with different details.", false);
                default -> OfferOutcome.of(409, "conflict", "stale-version",
                        "This offer has changed. Reload it and try again.", false);
            };
        }
        return unavailable();
    }

    private static OfferOutcome ok(JsonNode value, boolean replayed) {
        ObjectNode copy = value.deepCopy();
        if (replayed) copy.put("replayed", true);
        return OfferOutcome.ok(copy);
    }

    static OfferOutcome invalid() {
        return OfferOutcome.invalid("invalid-offer-decision", "Supply the exact offer, decision and current versions.");
    }

    static OfferOutcome unavailable() {
        return OfferOutcome.of(503, "unavailable", "offer-decision-unavailable",
                "Offer decisions are temporarily unavailable.", true);
    }

    static OfferOutcome inconsistent() {
        return OfferOutcome.of(503, "unavailable", "offer-authority-inconsistent",
                "This offer cannot be decided right now. Ask the scheme team to check it.", false);
    }

    static OfferOutcome remoteRequired() {
        return OfferOutcome.of(503, "unavailable", "remote-decision-protocol-required",
                "This offer needs the remote decision protocol, which is not available yet.", false);
    }

    private static OfferOutcome reasonsUnavailable() {
        return OfferOutcome.of(503, "unavailable", "decline-reasons-unavailable",
                "The decline reasons are unavailable right now. Try again shortly.", true);
    }

    private Stored stored(Principal p, String offerId) throws SQLException {
        try (Connection c = source().get().getConnection()) {
            return one(c, "SELECT command_id, input_digest, outcome::text, created_at FROM offer_decisions "
                    + "WHERE environment_id = ? AND run_id = ? AND offer_id = ?", rs -> {
                        try {
                            return new Stored(rs.getString(1), rs.getString(2),
                                    MAPPER.readTree(rs.getString(3)),
                                    instant(rs, 4));
                        } catch (java.io.IOException e) {
                            throw new SQLException("Stored decision is unreadable");
                        }
                    }, p.environmentId(), p.runId(), offerId);
        }
    }

    @FunctionalInterface
    interface Row<T> {
        T map(ResultSet rs) throws SQLException;
    }

    static <T> T one(Connection c, String sql, Row<T> row, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                Object v = params[i];
                ps.setObject(i + 1, v instanceof Instant t ? t.atOffset(java.time.ZoneOffset.UTC) : v);
            }
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? row.map(rs) : null;
            }
        }
    }

    static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime at = rs.getObject(column, OffsetDateTime.class);
        return at == null ? null : at.toInstant();
    }

    private static RunContext context(Principal p) {
        return new RunContext(p.environmentId(), p.runId(), p.subject());
    }

    private BooleanSupplier active() {
        return active != null ? active : persistence::active;
    }

    private Supplier<DataSource> source() {
        return source != null ? source : sources::get;
    }

    private Supplier<RemoteBuddy> buddy() {
        return buddy != null ? buddy : remote::get;
    }

    private Supplier<Optional<OrderingService>> ordering() {
        return ordering != null ? ordering : () -> orderingHolder.service();
    }

    Optional<OrderingService> orderingService() {
        return ordering().get();
    }

    /** The account port, or null when none is wired. */
    AccountRecordsPort accounts() {
        return accounts != null ? accounts.get() : accountPort.isResolvable() ? accountPort.get() : null;
    }

    PolicyService policy() {
        return policy;
    }

    PolicyClock clock() {
        return clock;
    }
}
