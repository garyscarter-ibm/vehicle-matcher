package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;

/** Seeds the private test schema: the Node account goldens as employee records, and released or held stock rows. */
final class RecommendationDb {

    static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> TYPED_SLOT_KEYS =
            List.of("employeeId", "entitlementSlotId", "capacity", "runId", "version", "createdAt", "updatedAt");

    private RecommendationDb() {}

    static JsonNode resource(String path) throws IOException {
        try (InputStream in = RecommendationDb.class.getResourceAsStream(path)) {
            return JSON.readTree(in);
        }
    }

    static JsonNode golden(String name) throws IOException {
        return resource("/account/node-baseline/" + name + ".json");
    }

    private static void update(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Both employees (membership, record aggregate, slots) in the active run; present already is fine. */
    static void seedEmployees() throws Exception {
        try (Connection c = RecommendationHttpProfiles.pool().getConnection()) {
            for (String name : List.of("paula", "jordan")) {
                JsonNode g = golden(name);
                JsonNode ctx = g.get("context");
                String employee = ctx.get("employeeId").asText();
                ObjectNode membership = JSON.createObjectNode().put("name", ctx.get("name").asText())
                        .put("companyId", ctx.get("companyId").asText()).put("schemeId", ctx.get("schemeId").asText())
                        .put("gradeId", ctx.get("gradeId").asText()).put("entitlementSlotId", ctx.get("entitlementSlotId").asText());
                update(c, "INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, ?, ?::jsonb) "
                        + "ON CONFLICT DO NOTHING", RecommendationHttpProfiles.ENV, RecommendationHttpProfiles.RUN, employee,
                        membership.toString());
                JsonNode record = g.get("input").get("manualContext");
                update(c, "INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                        + "VALUES (?, ?, ?, ?, ?::jsonb, ?) ON CONFLICT DO NOTHING", RecommendationHttpProfiles.ENV,
                        RecommendationHttpProfiles.RUN, employee, record.get("recordSetId").asText(), record.toString(),
                        g.get("input").get("employeeVersion").asLong());
                for (JsonNode slot : g.get("input").get("slots")) {
                    ObjectNode attributes = JSON.createObjectNode();
                    slot.fields().forEachRemaining(e -> {
                        if (!TYPED_SLOT_KEYS.contains(e.getKey())) attributes.set(e.getKey(), e.getValue());
                    });
                    update(c, "INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, "
                            + "version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?::timestamptz, ?::timestamptz) "
                            + "ON CONFLICT DO NOTHING", RecommendationHttpProfiles.ENV, RecommendationHttpProfiles.RUN,
                            slot.get("entitlementSlotId").asText(), employee, slot.get("capacity").asInt(), attributes.toString(),
                            slot.get("version").asLong(), slot.get("createdAt").asText(), slot.get("updatedAt").asText());
                }
            }
        }
    }

    /** Removes every stock row and hold of the run; the schema belongs to these tests alone. */
    static void clearStock() throws SQLException {
        try (Connection c = RecommendationHttpProfiles.pool().getConnection()) {
            update(c, "DELETE FROM custody_holds WHERE environment_id = ? AND run_id = ?", RecommendationHttpProfiles.ENV,
                    RecommendationHttpProfiles.RUN);
            update(c, "DELETE FROM stock_cars WHERE environment_id = ? AND run_id = ?", RecommendationHttpProfiles.ENV,
                    RecommendationHttpProfiles.RUN);
        }
    }

    /** Inserts released cars as the Node rows (attributes = everything but the typed columns). */
    static void insertStock(List<JsonNode> rows) throws SQLException {
        try (Connection c = RecommendationHttpProfiles.pool().getConnection();
                PreparedStatement ps = c.prepareStatement("INSERT INTO stock_cars (environment_id, run_id, order_uuid, "
                        + "configuration_id, state, attributes, version) VALUES (?, ?, ?, ?, 'released', ?::jsonb, ?)")) {
            for (JsonNode row : rows) {
                ObjectNode attributes = ((ObjectNode) row).deepCopy();
                attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
                ps.setString(1, RecommendationHttpProfiles.ENV);
                ps.setString(2, RecommendationHttpProfiles.RUN);
                ps.setString(3, row.get("orderUuid").asText());
                ps.setString(4, row.get("configurationId").asText());
                ps.setString(5, attributes.toString());
                ps.setLong(6, row.get("version").asLong());
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }

    /** An active custody hold of Jordan's slot on a car, so the car is occupied for everyone. */
    static void holdForJordan(String orderUuid) throws SQLException {
        try (Connection c = RecommendationHttpProfiles.pool().getConnection()) {
            update(c, "INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                    + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, 'employee-jordan', 'slot-jordan', 1, 'cart', 'active', "
                    + "now() + interval '1 day')", RecommendationHttpProfiles.ENV, RecommendationHttpProfiles.RUN,
                    "hold-" + orderUuid, orderUuid);
        }
    }
}
