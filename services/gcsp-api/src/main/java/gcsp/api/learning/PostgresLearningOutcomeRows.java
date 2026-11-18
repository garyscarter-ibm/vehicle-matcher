package gcsp.api.learning;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/** Saved producer facts translated to the retained projection contract, within its caller's run snapshot. */
@ApplicationScoped
public class PostgresLearningOutcomeRows implements LearningOutcomeRows {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    @FunctionalInterface
    private interface RowReader {
        ObjectNode read(ResultSet rs) throws SQLException;
    }

    @Override
    public boolean bound() {
        return true;
    }

    @Override
    public Rows read(Connection snapshot, String environmentId, String runId) throws SQLException {
        List<JsonNode> offers = query(snapshot, environmentId, runId,
                "SELECT o.offer_id, o.hold_id, o.quote_id, o.employee_id, o.order_uuid, o.state, o.brief_version, "
                        + "o.policy_version, h.attributes::text, q.quoted_at, EXISTS (SELECT 1 FROM buddy_operations b "
                        + "WHERE b.environment_id = o.environment_id AND b.run_id = o.run_id AND b.hold_id = o.hold_id "
                        + "AND b.operation_type = 'buddy-claim') FROM buddy_offers o "
                        + "JOIN custody_holds h USING (environment_id, run_id, hold_id) "
                        + "JOIN buddy_quotes q ON q.environment_id = o.environment_id AND q.run_id = o.run_id "
                        + "AND q.quote_id = o.quote_id WHERE o.environment_id = ? AND o.run_id = ? ORDER BY o.offer_id", rs -> {
                    ObjectNode row = JSON.objectNode().put("runId", runId).put("offerId", rs.getString(1))
                            .put("holdId", rs.getString(2)).put("quoteId", rs.getString(3)).put("employeeId", rs.getString(4))
                            .put("orderUuid", rs.getString(5)).put("state", rs.getString(6)).put("briefVersion", rs.getLong(7))
                            .put("policyVersion", rs.getString(8));
                    // Local quote and offer are written atomically at quoted_at. A remote claim completes later.
                    if (!rs.getBoolean(11)) row.put("offeredAt", iso(rs, 10));
                    JsonNode attributes = json(rs.getString(9));
                    if ("expired".equals(rs.getString(6))) copy(row, attributes, "expiredAt");
                    return row;
                });
        List<JsonNode> holds = query(snapshot, environmentId, runId,
                "SELECT h.hold_id, h.order_uuid, h.employee_id, h.slot_id, h.hold_type, h.state, h.attributes::text, "
                        + "h.operation_id, EXISTS (SELECT 1 FROM buddy_operations b WHERE b.environment_id = h.environment_id "
                        + "AND b.run_id = h.run_id AND b.hold_id = h.hold_id AND b.operation_type = 'buddy-claim'), "
                        + "d.payload::text FROM custody_holds h LEFT JOIN offer_decision_operations d "
                        + "ON d.environment_id = h.environment_id AND d.run_id = h.run_id AND d.operation_id = h.operation_id "
                        + "AND d.hold_id = h.hold_id AND d.operation_type = 'offer-selection' "
                        + "WHERE h.environment_id = ? AND h.run_id = ? ORDER BY h.hold_id", rs -> {
                    ObjectNode row = JSON.objectNode().put("runId", runId).put("holdId", rs.getString(1))
                            .put("orderUuid", rs.getString(2)).put("employeeId", rs.getString(3))
                            .put("entitlementSlotId", rs.getString(4)).put("type", rs.getString(5)).put("state", rs.getString(6));
                    JsonNode attributes = json(rs.getString(7));
                    copy(row, attributes, "quoteId", "renewalId", "pendingAt");
                    if ("selection-pending".equals(rs.getString(6))) {
                        // The current immutable selection intent owns this demo-clock time, not storage timestamps.
                        JsonNode decidedAt = json(rs.getString(10)).get("decidedAt");
                        if (decidedAt != null && !decidedAt.isNull()) row.set("pendingAt", decidedAt);
                    }
                    if ("allocated".equals(rs.getString(6)) && attributes.has("allocatedAt")) {
                        row.set("selectedAt", attributes.get("allocatedAt"));
                    }
                    // Node's marker means remote claim, whereas Java assigns an operation id to local claims too.
                    if (rs.getBoolean(9)) row.put("operationId", rs.getString(8));
                    return row;
                });
        List<JsonNode> decisions = query(snapshot, environmentId, runId,
                "SELECT decision_id, offer_id, hold_id, employee_id, decision, reason::text, versions::text, "
                        + "outcome::text, decided_at FROM offer_decisions WHERE environment_id = ? AND run_id = ? "
                        + "ORDER BY offer_id", rs -> {
                    ObjectNode row = JSON.objectNode().put("runId", runId).put("decisionId", rs.getString(1))
                            .put("offerId", rs.getString(2)).put("holdId", rs.getString(3)).put("employeeId", rs.getString(4))
                            .put("decision", rs.getString(5)).put("decidedAt", iso(rs, 9));
                    row.set("reason", json(rs.getString(6)));
                    JsonNode versions = json(rs.getString(7));
                    if (!versions.isObject()) throw new SQLException("Stored decision versions are not an object");
                    ObjectNode mapped = ((ObjectNode) versions).deepCopy();
                    if (!mapped.has("brief") && mapped.has("briefVersion")) mapped.set("brief", mapped.get("briefVersion"));
                    row.set("versions", mapped);
                    // offer_decisions is immutable and holds final successful decisions; its outcome is the business value.
                    row.putObject("outcome").put("status", "ok").set("value", json(rs.getString(8)));
                    return row;
                });
        List<JsonNode> quotes = query(snapshot, environmentId, runId,
                "SELECT quote_id, order_uuid, employee_id, slot_id, configuration_id, policy_version, quoted_at, "
                        + "valid_until, monthly_points, quote::text FROM buddy_quotes WHERE environment_id = ? AND run_id = ? "
                        + "ORDER BY quote_id", rs -> {
                    ObjectNode row = JSON.objectNode().put("runId", runId).put("quoteId", rs.getString(1))
                            .put("orderUuid", rs.getString(2)).put("employeeId", rs.getString(3)).put("entitlementSlotId", rs.getString(4))
                            .put("configurationId", rs.getString(5)).put("policyVersion", rs.getString(6)).put("quotedAt", iso(rs, 7));
                    String until = iso(rs, 8);
                    if (until != null) row.put("validUntil", until);
                    Integer monthly = (Integer) rs.getObject(9);
                    if (monthly != null) row.putObject("monthlyPoints").put("value", monthly).put("unit", "points");
                    JsonNode saved = json(rs.getString(10));
                    JsonNode brief = saved.path("versions").get("brief");
                    if (brief != null) row.set("briefVersion", brief);
                    JsonNode allowance = saved.path("terms").path("allowanceInputs").get("allowance");
                    if (allowance != null) row.putObject("allowance").set("allowance", allowance);
                    return row;
                });
        List<JsonNode> receipts = query(snapshot, environmentId, runId,
                "SELECT payload::text FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                        + "AND event_type = 'buddy-expired' ORDER BY event_id", rs -> {
                    ObjectNode row = JSON.objectNode().put("consumerId", "buddy-expiry");
                    row.putObject("outcome").put("status", "ok").set("value", json(rs.getString(1)));
                    return row;
                });
        return new Rows(offers, holds, decisions, quotes, receipts);
    }

    private static List<JsonNode> query(Connection c, String env, String run, String sql, RowReader reader) throws SQLException {
        List<JsonNode> rows = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, env);
            ps.setString(2, run);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(reader.read(rs));
            }
        }
        return rows;
    }

    private static JsonNode json(String value) throws SQLException {
        try {
            return value == null ? JSON.nullNode() : MAPPER.readTree(value);
        } catch (JsonProcessingException e) {
            throw new SQLException("Stored learning source JSON is unreadable", e);
        }
    }

    private static String iso(ResultSet rs, int column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : PolicyClock.iso(value.toInstant());
    }

    private static void copy(ObjectNode target, JsonNode source, String... fields) {
        for (String field : fields) if (source.has(field)) target.set(field, source.get(field));
    }
}
