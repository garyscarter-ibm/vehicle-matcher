package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyClock;
import java.io.IOException;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/** One manual claim joined to its custody hold, with the SQL that reads it by key and the Node-shaped view. */
record ClaimRow(String holdId, String orderUuid, String employeeId, String slotId, String holdType, String state,
        Instant expiresAt, long version, String mode, String phase, Instant reviewStartedAt, String policyVersion,
        long draftVersion, String contextVersion, String termsDigest, JsonNode quote, Instant quotedAt,
        Instant validUntil, String releaseReason, String operationId) {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SELECT = "SELECT h.hold_id, h.order_uuid, h.employee_id, h.slot_id, h.hold_type, "
            + "h.state, h.expires_at, h.version, c.mode, c.phase, c.review_started_at, c.policy_version, "
            + "c.draft_version, c.context_version, c.terms_digest, c.quote::text, c.quoted_at, c.valid_until, "
            + "c.release_reason, h.operation_id FROM custody_holds h JOIN manual_claims c ON c.environment_id = h.environment_id "
            + "AND c.run_id = h.run_id AND c.hold_id = h.hold_id ";

    static ClaimRow map(ResultSet rs) throws SQLException {
        try {
            return new ClaimRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                    rs.getString(6), Db.instant(rs, 7), rs.getLong(8), rs.getString(9), rs.getString(10),
                    Db.instant(rs, 11), rs.getString(12), rs.getLong(13), rs.getString(14), rs.getString(15),
                    JSON.readTree(rs.getString(16)), Db.instant(rs, 17), Db.instant(rs, 18), rs.getString(19), rs.getString(20));
        } catch (IOException e) {
            throw new SQLException("Stored quote is unreadable");
        }
    }

    /** By hold key; lock takes a row lock on the hold so a concurrent change waits and then re-reads. */
    static Optional<ClaimRow> byHold(Connection c, String env, String run, String holdId, boolean lock)
            throws SQLException {
        return Db.first(c, SELECT + "WHERE h.environment_id = ? AND h.run_id = ? AND h.hold_id = ?"
                + (lock ? " FOR UPDATE OF h" : ""), ClaimRow::map, env, run, holdId);
    }

    /** The employee's latest claim, by the manual_claims_owner index prefix; one employee has few claims. */
    static Optional<ClaimRow> latest(Connection c, String env, String run, String employeeId) throws SQLException {
        return Db.first(c, SELECT + "WHERE c.environment_id = ? AND c.run_id = ? AND c.employee_id = ? "
                + "ORDER BY c.created_at DESC, c.hold_id DESC LIMIT 1", ClaimRow::map, env, run, employeeId);
    }

    /** The Node snapshot state: an active hold reads as quoted. */
    String viewState() {
        return "active".equals(state) ? "quoted" : state;
    }

    boolean pending() {
        return state.endsWith("-pending");
    }

    String action() {
        if (pending()) return "check-status";
        return switch (viewState()) {
            case "quoted" -> "order-review".equals(phase) ? "submit-or-cancel" : "review-or-cancel";
            case "allocated" -> "continue-order-handoff";
            default -> "browse-stock";
        };
    }

    boolean due(Instant now) {
        return !expiresAt.isAfter(now);
    }

    ObjectNode hold() {
        ObjectNode h = JSON.createObjectNode();
        h.put("holdId", holdId);
        h.put("orderUuid", orderUuid);
        h.put("employeeId", employeeId);
        h.put("entitlementSlotId", slotId);
        h.put("type", holdType);
        h.put("state", state);
        h.put("phase", phase);
        h.put("mode", mode);
        h.put("version", version);
        h.put("expiresAt", PolicyClock.iso(expiresAt));
        if (reviewStartedAt == null) h.putNull("reviewStartedAt"); else h.put("reviewStartedAt", PolicyClock.iso(reviewStartedAt));
        if (releaseReason == null) h.putNull("releaseReason"); else h.put("releaseReason", releaseReason);
        return h;
    }

    /** The open remote operation behind a pending hold, as the Node snapshot shows it; null when none is open. */
    private JsonNode pendingOperation() {
        if (!pending() || operationId == null) return JSON.nullNode();
        ObjectNode o = JSON.createObjectNode();
        o.put("operationId", operationId);
        o.put("operationType", switch (state) {
            case "claim-pending" -> "manual-claim";
            case "release-pending" -> "manual-release";
            default -> "manual-allocate";
        });
        o.put("lastKnownState", "claim-pending".equals(state) ? state : "active");
        return o;
    }

    ObjectNode view(Instant now) {
        ObjectNode v = JSON.createObjectNode();
        v.put("state", viewState());
        v.set("hold", hold());
        v.set("quote", quote);
        v.set("pendingOperation", pendingOperation());
        v.put("now", PolicyClock.iso(now));
        v.set("view", ClaimResult.viewOf(pending() ? "pending" : viewState(), action()));
        return v;
    }

    ClaimView forOrdering() {
        return new ClaimView(holdId, orderUuid, employeeId, slotId, state, phase, expiresAt, version, mode,
                termsDigest, validUntil, quote);
    }
}
