package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;

/** Lapses due local Buddy holds at one tick: one transaction, so one tick's lapses share one run revision. */
public final class BuddyExpiry {

    private static final int PAGE = 200;
    private static final String AUTHORITY = "authority-reconciliation-required";
    private static final String STOCK = "stock-reconciliation-required";

    private record Due(String holdId, String orderUuid, String employeeId, Instant expiresAt, long version,
            String policyVersion, String quoteId) {}

    private record Offer(String offerId, String state, String employeeId, String orderUuid, String quoteId,
            Instant expiresAt, long version) {}

    private final DataSource dataSource;
    private final PolicyService policy;

    public BuddyExpiry(DataSource dataSource, PolicyService policy) {
        this.dataSource = dataSource;
        this.policy = policy;
    }

    /** One expiry tick at the scope's instant. Running the same tick again replays. */
    public ExpiryResult expire(AllocationScope scope) {
        String problem = scope == null ? "The allocation scope is missing." : scope.problem();
        if (problem != null) return new ExpiryResult.Refused("invalid-scope", problem);
        RunContext ctx = new RunContext(scope.environmentId(), scope.runId(), AllocationService.ACTOR);
        TransactionRunner runner = new TransactionRunner(dataSource);
        String now = PolicyClock.iso(scope.now());
        ObjectNode input = Sql.JSON.createObjectNode().put("runId", scope.runId()).put("now", now)
                .put("clockVersion", scope.clockVersion());
        String commandId = "buddy-expiry:" + Canonical.digest(Sql.JSON.createArrayNode().add(scope.runId()).add(now)
                .add(scope.clockVersion()));
        Command command = new Command("buddy.expire", commandId, input);
        Outcome o = AllocationService.settle(runner, ctx, commandId, () -> runner.execute(ctx, command,
                tx -> run(tx, scope, now)));
        if (o instanceof Outcome.Committed committed) return done(committed);
        if (o instanceof Outcome.Refused r) return new ExpiryResult.Refused(r.code(), r.message());
        if (o instanceof Outcome.Conflict c && "command-input-changed".equals(c.code())) {
            return new ExpiryResult.Refused(c.code(), c.message());
        }
        return new ExpiryResult.Pending(o.code(), o.retryable() || o instanceof Outcome.Uncertain);
    }

    private WorkResult run(Tx tx, AllocationScope scope, String now) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        ArrayNode expired = Sql.JSON.createArrayNode();
        ArrayNode retained = Sql.JSON.createArrayNode();
        Set<String> checked = new HashSet<>();
        Instant afterExpiry = null;
        String afterHold = "";
        while (true) {
            List<Due> page = Sql.query(c, "SELECT hold_id, order_uuid, employee_id, expires_at, version, "
                    + "attributes->>'policyVersion', attributes->>'quoteId' FROM custody_holds WHERE environment_id = ? "
                    + "AND run_id = ? AND hold_type = 'buddy-offer' AND state = 'active' AND expires_at <= ? "
                    + "AND (expires_at, hold_id) > (?::timestamptz, ?) ORDER BY expires_at, hold_id LIMIT ?",
                    rs -> new Due(rs.getString(1), rs.getString(2), rs.getString(3), Sql.instant(rs, 4), rs.getLong(5),
                            rs.getString(6), rs.getString(7)), x.environmentId(), x.runId(), scope.now(),
                    afterExpiry == null ? "-infinity" : afterExpiry, afterHold, PAGE);
            for (Due hold : page) {
                if (hold.policyVersion() != null && checked.add(hold.policyVersion()) && !inclusive(scope, now, hold)) {
                    return WorkResult.refuse("policy-unavailable", "The hold deadline policy is unavailable.");
                }
                String reason = retention(c, x, hold);
                if (reason != null) {
                    retained.addObject().put("holdId", hold.holdId()).put("reason", reason);
                } else {
                    expired.add(lapse(tx, hold, now));
                }
            }
            if (page.size() < PAGE) break;
            Due last = page.get(page.size() - 1);
            afterExpiry = last.expiresAt();
            afterHold = last.holdId();
        }
        ObjectNode result = Sql.JSON.createObjectNode();
        result.set("expired", expired);
        result.set("retained", retained);
        return WorkResult.ok(result);
    }

    /** The deadline is inclusive under the hold's own policy version, or the tick is refused. */
    private boolean inclusive(AllocationScope scope, String now, Due hold) {
        try {
            PolicyResult r = policy.getAssumption("hold.deadline.inclusive",
                    new PolicyRead(scope.runId(), now, hold.policyVersion()));
            return r.ok() && hold.policyVersion().equals(r.policyVersion()) && r.value() != null
                    && r.value().path("value").isBoolean() && r.value().path("value").booleanValue();
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The reason a due hold is left unchanged, or null when it may lapse. */
    private static String retention(Connection c, RunContext x, Due hold) throws SQLException {
        if (hold.policyVersion() == null) return AUTHORITY;
        if (Sql.one(c, "SELECT 1 FROM buddy_operations WHERE environment_id = ? AND run_id = ? AND hold_id = ? LIMIT 1",
                rs -> 1, x.environmentId(), x.runId(), hold.holdId()) != null) {
            return AUTHORITY;
        }
        List<Offer> offers = Sql.query(c, "SELECT offer_id, state, employee_id, order_uuid, quote_id, expires_at, version "
                + "FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND hold_id = ?",
                rs -> new Offer(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        Sql.instant(rs, 6), rs.getLong(7)), x.environmentId(), x.runId(), hold.holdId());
        if (offers.size() != 1) return AUTHORITY;
        Offer offer = offers.get(0);
        if (!"active".equals(offer.state()) || !hold.employeeId().equals(offer.employeeId())
                || !hold.orderUuid().equals(offer.orderUuid()) || !offer.quoteId().equals(hold.quoteId())
                || !hold.expiresAt().equals(offer.expiresAt())) {
            return AUTHORITY;
        }
        String carState = Sql.one(c, "SELECT state FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", rs -> rs.getString(1), x.environmentId(), x.runId(), hold.orderUuid());
        if (!"released".equals(carState) || otherAuthority(c, x, hold)) return STOCK;
        return null;
    }

    private static boolean otherAuthority(Connection c, RunContext x, Due hold) throws SQLException {
        return Sql.one(c, "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? AND order_uuid = ? "
                + "AND hold_id <> ? AND (state IN " + Buddy.OCCUPYING + " OR state = 'allocated') LIMIT 1", rs -> 1,
                x.environmentId(), x.runId(), hold.orderUuid(), hold.holdId()) != null;
    }

    /** Expires hold and offer and bumps the car by version CAS; the car stays released (occupancy was the hold). */
    private static ObjectNode lapse(Tx tx, Due hold, String now) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        Offer offer = Sql.one(c, "SELECT offer_id, state, employee_id, order_uuid, quote_id, expires_at, version "
                + "FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND hold_id = ?",
                rs -> new Offer(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        Sql.instant(rs, 6), rs.getLong(7)), x.environmentId(), x.runId(), hold.holdId());
        Long carVersion = Sql.one(c, "SELECT version FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", rs -> rs.getLong(1), x.environmentId(), x.runId(), hold.orderUuid());
        ObjectNode patch = Sql.JSON.createObjectNode().put("releaseReason", "buddy-expired").put("expiredAt", now);
        tx.cas("UPDATE custody_holds SET state = 'expired', attributes = attributes || ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'active'", patch, x.environmentId(), x.runId(), hold.holdId(), hold.version());
        tx.cas("UPDATE buddy_offers SET state = 'expired', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'active'",
                x.environmentId(), x.runId(), offer.offerId(), offer.version());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", x.environmentId(), x.runId(), hold.orderUuid(), carVersion);
        ObjectNode out = Sql.JSON.createObjectNode();
        out.put("holdId", hold.holdId()).put("offerId", offer.offerId()).put("orderUuid", hold.orderUuid())
                .put("employeeId", hold.employeeId()).put("expiresAt", PolicyClock.iso(hold.expiresAt()))
                .put("expiredAt", now).put("policyVersion", hold.policyVersion());
        tx.emit("buddy-expired:" + hold.holdId(), "buddy-expired", out);
        return out;
    }

    private static ExpiryResult done(Outcome.Committed committed) {
        JsonNode result = committed.result();
        List<ExpiryResult.Lapse> expired = new ArrayList<>();
        for (JsonNode n : result.path("expired")) {
            expired.add(new ExpiryResult.Lapse(n.path("holdId").asText(), n.path("offerId").asText(),
                    n.path("orderUuid").asText(), n.path("employeeId").asText(), n.path("expiresAt").asText(),
                    n.path("expiredAt").asText()));
        }
        List<ExpiryResult.Retained> retained = new ArrayList<>();
        for (JsonNode n : result.path("retained")) {
            retained.add(new ExpiryResult.Retained(n.path("holdId").asText(), n.path("reason").asText()));
        }
        return new ExpiryResult.Done(expired, retained, committed.replayed());
    }
}
