package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;

/** Remote Buddy custody rows shared by the lifecycle and expiry: load, alignment, closing and starting a release. */
final class RemoteOps {

    record Op(String operationId, String type, String holdId, JsonNode payload) {
        boolean claim() {
            return "buddy-claim".equals(type);
        }
    }

    record Hold(String holdId, String state, String operationId, long version, Instant expiresAt, String orderUuid,
            String employeeId, String slotId, int slotUnit, String policyVersion, String renewalId, String offerId) {}

    record Offer(String offerId, String state, long version) {}

    record Car(String state, long version, String configurationId, JsonNode attributes) {}

    record Rows(Op op, Hold hold, Offer offer, Car car) {}

    private RemoteOps() {}

    /** The operation with its hold, offer and car, or null when any is missing or disagrees with the payload. */
    static Rows load(Connection c, RunContext x, String operationId) throws SQLException {
        Op op = Sql.one(c, "SELECT operation_type, hold_id, payload::text FROM buddy_operations WHERE environment_id = ? "
                + "AND run_id = ? AND operation_id = ?", rs -> new Op(operationId, rs.getString(1), rs.getString(2),
                        Sql.json(rs.getString(3))), x.environmentId(), x.runId(), operationId);
        if (op == null) return null;
        Hold hold = Sql.one(c, "SELECT hold_id, state, operation_id, version, expires_at, order_uuid, employee_id, slot_id, "
                + "slot_unit, attributes->>'policyVersion', attributes->>'renewalId', attributes->>'offerId' "
                + "FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id = ?",
                rs -> new Hold(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), Sql.instant(rs, 5),
                        rs.getString(6), rs.getString(7), rs.getString(8), rs.getInt(9), rs.getString(10),
                        rs.getString(11), rs.getString(12)), x.environmentId(), x.runId(), op.holdId());
        if (hold == null) return null;
        Offer offer = Sql.one(c, "SELECT offer_id, state, version FROM buddy_offers WHERE environment_id = ? AND run_id = ? "
                + "AND hold_id = ?", rs -> new Offer(rs.getString(1), rs.getString(2), rs.getLong(3)), x.environmentId(),
                x.runId(), op.holdId());
        Car car = Sql.one(c, "SELECT state, version, configuration_id, attributes::text FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", rs -> new Car(rs.getString(1),
                        rs.getLong(2), rs.getString(3), Sql.json(rs.getString(4))), x.environmentId(), x.runId(),
                hold.orderUuid());
        JsonNode p = op.payload();
        if (car == null || !op.holdId().equals(p.path("holdId").asText()) || !hold.orderUuid().equals(p.path("orderUuid").asText())
                || !hold.employeeId().equals(p.path("employeeId").asText())) {
            return null;
        }
        return new Rows(op, hold, offer, car);
    }

    /** The hold, offer and car are exactly as this operation left them, and nothing else occupies the car, unit or renewal. */
    static boolean aligned(Connection c, RunContext x, Rows r) throws SQLException {
        String state = r.op().claim() ? "claim-pending" : "release-pending";
        Hold h = r.hold();
        boolean offerOk = r.op().claim() ? r.offer() == null : r.offer() == null || "release-pending".equals(r.offer().state());
        if (!state.equals(h.state()) || !r.op().operationId().equals(h.operationId())
                || h.version() != r.op().payload().path("expectedHoldVersion").asLong(-1) || !offerOk
                || !"released".equals(r.car().state())) {
            return false;
        }
        return !otherOccupant(c, x, h);
    }

    /** Another occupying or allocated hold on this car, slot unit or renewal. */
    static boolean otherOccupant(Connection c, RunContext x, Hold h) throws SQLException {
        return Sql.one(c, "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id <> ? "
                + "AND (state IN " + Buddy.OCCUPYING + " OR state = 'allocated') AND (order_uuid = ? "
                + "OR (slot_id = ? AND slot_unit = ? AND state IN " + Buddy.OCCUPYING + ") "
                + "OR (?::text IS NOT NULL AND attributes->>'renewalId' = ?)) LIMIT 1", rs -> 1, x.environmentId(),
                x.runId(), h.holdId(), h.orderUuid(), h.slotId(), h.slotUnit(), h.renewalId(), h.renewalId()) != null;
    }

    /** Moves hold, offer and car to a closed state by version CAS; an expired target also emits the lapse event. */
    static ObjectNode close(Tx tx, Rows r, String target, String reason, Instant now) throws SQLException {
        RunContext x = tx.context();
        Hold h = r.hold();
        boolean expired = "expired".equals(target);
        ObjectNode patch = Sql.JSON.createObjectNode().put("releaseReason", reason);
        if (expired) patch.put("expiredAt", PolicyClock.iso(now));
        tx.cas("UPDATE custody_holds SET state = ?, attributes = attributes || ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ?", target, patch,
                x.environmentId(), x.runId(), h.holdId(), h.version());
        if (r.offer() != null) {
            tx.cas("UPDATE buddy_offers SET state = ?, version = version + 1, updated_at = now() WHERE environment_id = ? "
                    + "AND run_id = ? AND offer_id = ? AND version = ?", target, x.environmentId(), x.runId(),
                    r.offer().offerId(), r.offer().version());
        }
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND version = ?", x.environmentId(), x.runId(), h.orderUuid(), r.car().version());
        ObjectNode out = Sql.JSON.createObjectNode().put("state", target).put("holdId", h.holdId())
                .put("orderUuid", h.orderUuid());
        if (r.offer() != null) out.put("offerId", r.offer().offerId());
        out.put("expiresAt", PolicyClock.iso(h.expiresAt()));
        if (expired) {
            out.put("expiredAt", PolicyClock.iso(now));
            ObjectNode event = Sql.JSON.createObjectNode();
            event.put("holdId", h.holdId()).put("offerId", r.offer() == null ? h.offerId() : r.offer().offerId())
                    .put("orderUuid", h.orderUuid())
                    .put("employeeId", h.employeeId()).put("expiresAt", PolicyClock.iso(h.expiresAt()))
                    .put("expiredAt", PolicyClock.iso(now)).put("policyVersion", h.policyVersion());
            tx.emit("buddy-expired:" + h.holdId(), "buddy-expired", event);
        }
        return out;
    }

    /** Closes an open pending operation by version CAS without touching its attempt count. */
    static void closeOperation(Tx tx, String operationId, long version, String state, JsonNode outcome) throws SQLException {
        RunContext x = tx.context();
        tx.cas("UPDATE pending_operations SET state = ?, outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? "
                + "AND state IN ('intent', 'pending')", state, outcome, x.environmentId(), x.runId(), operationId, version);
    }

    /** Parks the hold (and offer) as release-pending and records the release operation. The car is never freed here. */
    static String startRelease(Tx tx, Rows r, String reason) throws SQLException {
        RunContext x = tx.context();
        Hold h = r.hold();
        String claimId = r.op().operationId();
        String releaseId = "buddy-op:" + Canonical.digest(Sql.JSON.createArrayNode().add(claimId).add("buddy-release"));
        long holdVersion = h.version() + 1;
        ObjectNode patch = Sql.JSON.createObjectNode().put("releaseReason", reason);
        tx.cas("UPDATE custody_holds SET state = 'release-pending', operation_id = ?, attributes = attributes || ?, "
                + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? "
                + "AND version = ?", releaseId, patch, x.environmentId(), x.runId(), h.holdId(), h.version());
        if (r.offer() != null) {
            tx.cas("UPDATE buddy_offers SET state = 'release-pending', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ?", x.environmentId(),
                    x.runId(), r.offer().offerId(), r.offer().version());
        }
        ObjectNode payload = ((ObjectNode) r.op().payload()).deepCopy();
        payload.put("sourceClaimOperationId", claimId).put("reason", reason)
                .put("target", "buddy-expired".equals(reason) ? "expired" : "released")
                .put("expectedStockVersion", r.car().version()).put("expectedHoldVersion", holdVersion);
        PendingOperations.recordIntent(tx, releaseId, "buddy-release", claimId + ":release", payload);
        tx.write("INSERT INTO buddy_operations (environment_id, run_id, operation_id, operation_type, hold_id, "
                + "source_claim_operation_id, payload) VALUES (?, ?, ?, 'buddy-release', ?, ?, ?)", x.environmentId(),
                x.runId(), releaseId, h.holdId(), claimId, payload);
        return releaseId;
    }
}
