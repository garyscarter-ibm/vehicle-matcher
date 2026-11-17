package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import javax.sql.DataSource;

/**
 * The seven demand tables for one run from a single read-only snapshot, in the field names Node's forecast provider reads (FUCQ-477).
 * A missing optional field is absent, never null, unless the stored JSON value is null.
 */
final class PostgresDemandSnapshot {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();

    private PostgresDemandSnapshot() {
    }

    private interface Mapper {
        void row(ResultSet rs) throws SQLException;
    }

    private static void query(Connection c, String sql, RunContext ctx, Mapper mapper) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    mapper.row(rs);
                }
            }
        }
    }

    private static String iso(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : PolicyClock.iso(t.toInstant());
    }

    private static JsonNode json(String text) throws SQLException {
        try {
            return text == null ? F.nullNode() : JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }

    /** Copies each listed key from the stored attributes as its stored JSON value, only when the key exists. */
    private static void copyPresent(ObjectNode out, JsonNode attributes, String... keys) {
        for (String key : keys) {
            if (attributes.has(key)) {
                out.set(key, attributes.get(key));
            }
        }
    }

    /** Every demand input row for the run from one REPEATABLE READ snapshot; null when the run is not the active one. */
    static ObjectNode load(DataSource ds, RunContext ctx) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            try {
                return read(c, ctx);
            } finally {
                c.rollback();
                c.setReadOnly(false);
                c.setAutoCommit(true);
                c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            }
        }
    }

    private static ObjectNode read(Connection c, RunContext ctx) throws SQLException {
        boolean[] active = {false};
        query(c, "SELECT status FROM runs WHERE environment_id = ? AND run_id = ?", ctx,
                rs -> active[0] = "active".equals(rs.getString(1)));
        if (!active[0]) {
            return null;
        }
        String runId = ctx.runId();
        ObjectNode rows = F.objectNode();
        ArrayNode employees = rows.putArray("employees");
        query(c, "SELECT e.employee_id, e.version, e.attributes::text, r.record::text FROM employees e "
                + "LEFT JOIN employee_account_records r ON r.environment_id = e.environment_id AND r.run_id = e.run_id "
                + "AND r.employee_id = e.employee_id WHERE e.environment_id = ? AND e.run_id = ? ORDER BY e.employee_id", ctx, rs -> {
                    ObjectNode e = employees.addObject();
                    e.put("runId", runId).put("employeeId", rs.getString(1)).put("version", rs.getLong(2));
                    copyPresent(e, json(rs.getString(3)), "companyId", "schemeId", "gradeId", "entitlementSlotId", "renewalId");
                    String record = rs.getString(4);
                    if (record != null) {
                        e.putObject("contract").set("manualContext", json(record));
                    }
                });
        ArrayNode briefs = rows.putArray("briefs");
        query(c, "SELECT b.employee_id, b.brief_version, b.previous_brief_version, b.operation, b.content::text, b.policy_version, "
                + "b.confirmed_by, b.confirmed_at, e.attributes::text FROM briefs b LEFT JOIN employees e "
                + "ON e.environment_id = b.environment_id AND e.run_id = b.run_id AND e.employee_id = b.employee_id "
                + "WHERE b.environment_id = ? AND b.run_id = ? ORDER BY b.employee_id, b.brief_version", ctx, rs -> {
                    JsonNode content = json(rs.getString(5));
                    if (!content.isObject()) {
                        throw new SQLException("Stored brief content is not an object");
                    }
                    ObjectNode b = ((ObjectNode) content).deepCopy();
                    b.put("runId", runId).put("employeeId", rs.getString(1)).put("briefVersion", rs.getLong(2));
                    long previous = rs.getLong(3);
                    if (rs.wasNull()) {
                        b.putNull("previousBriefVersion");
                    } else {
                        b.put("previousBriefVersion", previous);
                    }
                    b.put("status", "confirmed").put("operation", rs.getString(4)).put("policyVersion", rs.getString(6))
                            .put("confirmedBy", rs.getString(7)).put("confirmedAt", iso(rs, 8));
                    // Java briefs store no slot (D1): the owning employee's membership slot stands in.
                    String attributes = rs.getString(9);
                    JsonNode slot = attributes == null ? null : json(attributes).get("entitlementSlotId");
                    if (slot != null && slot.isTextual()) {
                        b.put("entitlementSlotId", slot.textValue());
                    }
                    briefs.add(b);
                });
        ArrayNode slots = rows.putArray("entitlement_slots");
        query(c, "SELECT slot_id, employee_id, capacity, version, attributes::text FROM entitlement_slots "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY slot_id", ctx, rs -> {
                    ObjectNode s = slots.addObject();
                    s.put("entitlementSlotId", rs.getString(1)).put("employeeId", rs.getString(2)).put("capacity", rs.getInt(3))
                            .put("version", rs.getLong(4));
                    copyPresent(s, json(rs.getString(5)), "renewalId", "state");
                });
        ArrayNode holds = rows.putArray("holds");
        query(c, "SELECT h.hold_id, h.order_uuid, h.employee_id, h.slot_id, h.hold_type, h.state, h.expires_at, h.version, "
                + "h.attributes::text, s.attributes::text FROM custody_holds h LEFT JOIN entitlement_slots s ON s.environment_id = "
                + "h.environment_id AND s.run_id = h.run_id AND s.slot_id = h.slot_id AND s.employee_id = h.employee_id "
                + "WHERE h.environment_id = ? AND h.run_id = ? ORDER BY h.hold_id", ctx, rs -> {
                    ObjectNode h = holds.addObject();
                    h.put("holdId", rs.getString(1)).put("orderUuid", rs.getString(2)).put("employeeId", rs.getString(3))
                            .put("entitlementSlotId", rs.getString(4)).put("type", rs.getString(5)).put("state", rs.getString(6))
                            .put("expiresAt", iso(rs, 7)).put("version", rs.getLong(8));
                    JsonNode attributes = json(rs.getString(9));
                    if (attributes.has("renewalId")) {
                        h.set("renewalId", attributes.get("renewalId"));
                    } else {
                        // D7: Java cart holds store no renewal; Node's manual claim takes slot.renewalId ?? null.
                        JsonNode slotRenewal = json(rs.getString(10)).get("renewalId");
                        h.set("renewalId", slotRenewal == null ? F.nullNode() : slotRenewal);
                    }
                });
        ArrayNode stock = rows.putArray("stock");
        query(c, "SELECT order_uuid, configuration_id, state, version FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY order_uuid", ctx, rs -> {
                    stock.addObject().put("orderUuid", rs.getString(1)).put("configurationId", rs.getString(2))
                            .put("state", rs.getString(3)).put("version", rs.getLong(4));
                });
        ArrayNode decisions = rows.putArray("decisions");
        query(c, "SELECT decision_id, offer_id, hold_id, employee_id, decision, reason_code, versions::text, decided_at "
                + "FROM offer_decisions WHERE environment_id = ? AND run_id = ? ORDER BY offer_id", ctx, rs -> {
                    ObjectNode d = decisions.addObject();
                    d.put("decisionId", rs.getString(1)).put("offerId", rs.getString(2)).put("holdId", rs.getString(3))
                            .put("employeeId", rs.getString(4)).put("decision", rs.getString(5));
                    String reason = rs.getString(6);
                    if (reason == null) {
                        d.putNull("reasonCode");
                    } else {
                        d.put("reasonCode", reason);
                    }
                    JsonNode versions = json(rs.getString(7)).deepCopy();
                    // Java stores versions.briefVersion where Node's evaluator reads versions.brief (D2).
                    if (versions.isObject() && !versions.has("brief") && versions.path("briefVersion").isIntegralNumber()) {
                        ((ObjectNode) versions).set("brief", versions.get("briefVersion"));
                    }
                    d.set("versions", versions);
                    d.put("decidedAt", iso(rs, 8));
                });
        ArrayNode offers = rows.putArray("offers");
        query(c, "SELECT offer_id, hold_id, employee_id, order_uuid, state, brief_version, policy_version, version FROM buddy_offers "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY offer_id", ctx, rs -> {
                    offers.addObject().put("offerId", rs.getString(1)).put("holdId", rs.getString(2))
                            .put("employeeId", rs.getString(3)).put("orderUuid", rs.getString(4)).put("state", rs.getString(5))
                            .put("briefVersion", rs.getLong(6)).put("policyVersion", rs.getString(7)).put("version", rs.getLong(8));
                });
        return rows;
    }
}
