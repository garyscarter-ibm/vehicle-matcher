package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The fixed set of snapshot reads behind a demand projection; each takes the snapshot connection. */
final class DemandStore {

    record Brief(String employeeId, long version, String policyVersion, JsonNode content) {}

    record Employee(String companyId, String schemeId) {}

    record Hold(String holdId, String orderUuid, String employeeId, String type, String state) {}

    /** Only the stock fields the projection reads; whole attributes are never loaded. */
    record Car(String orderUuid, String state, JsonNode modelLine, JsonNode eligibilityModelKey, JsonNode availability,
            JsonNode visibility) {}

    private DemandStore() {}

    /** The run's revision when it is active, else empty. */
    static Optional<Long> activeRevision(Connection c, DemandScope s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT status, revision FROM runs WHERE environment_id = ? AND run_id = ?")) {
            run(ps, s);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && "active".equals(rs.getString(1)) ? Optional.of(rs.getLong(2)) : Optional.empty();
            }
        }
    }

    /** The current confirmed brief of every employee: the head's version joined to its immutable row. */
    static List<Brief> currentBriefs(Connection c, DemandScope s) throws SQLException, IOException {
        try (PreparedStatement ps = c.prepareStatement("SELECT h.employee_id, b.brief_version, b.policy_version, b.content::text "
                + "FROM brief_heads h JOIN briefs b ON b.environment_id = h.environment_id AND b.run_id = h.run_id "
                + "AND b.employee_id = h.employee_id AND b.brief_version = h.brief_version "
                + "WHERE h.environment_id = ? AND h.run_id = ? AND h.brief_version > 0 ORDER BY h.employee_id")) {
            run(ps, s);
            List<Brief> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(new Brief(rs.getString(1), rs.getLong(2), rs.getString(3), Demand.parse(rs.getString(4))));
            }
            return out;
        }
    }

    /** Company and scheme of the employees who have a confirmed brief; a non-text value reads as absent. */
    static Map<String, Employee> owners(Connection c, DemandScope s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT e.employee_id, "
                + "CASE WHEN jsonb_typeof(e.attributes -> 'companyId') = 'string' THEN e.attributes ->> 'companyId' END, "
                + "CASE WHEN jsonb_typeof(e.attributes -> 'schemeId') = 'string' THEN e.attributes ->> 'schemeId' END "
                + "FROM employees e WHERE e.environment_id = ? AND e.run_id = ? AND EXISTS (SELECT 1 FROM brief_heads h "
                + "WHERE h.environment_id = e.environment_id AND h.run_id = e.run_id AND h.employee_id = e.employee_id "
                + "AND h.brief_version > 0)")) {
            run(ps, s);
            Map<String, Employee> out = new java.util.HashMap<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), new Employee(rs.getString(2), rs.getString(3)));
            }
            return out;
        }
    }

    static List<Hold> holds(Connection c, DemandScope s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT hold_id, order_uuid, employee_id, hold_type, state "
                + "FROM custody_holds WHERE environment_id = ? AND run_id = ?")) {
            run(ps, s);
            List<Hold> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(new Hold(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)));
            }
            return out;
        }
    }

    static List<Car> cars(Connection c, DemandScope s) throws SQLException, IOException {
        try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid, state, (attributes #> '{facts,facts,modelLine}')::text, "
                + "(attributes #> '{facts,facts,eligibilityModelKey}')::text, (attributes #> '{release,availability}')::text, "
                + "(attributes -> 'visibility')::text FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND state = 'released'")) {
            run(ps, s);
            List<Car> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Car(rs.getString(1), rs.getString(2), Demand.parse(rs.getString(3)), Demand.parse(rs.getString(4)),
                            Demand.parse(rs.getString(5)), Demand.parse(rs.getString(6))));
                }
            }
            return out;
        }
    }

    /** The stock source status from the latest delivered tick; any read problem is evidence-unavailable, never a failure. */
    static ObjectNode sourceStatus(Connection c, DemandScope s) throws SQLException {
        Savepoint sp = c.setSavepoint();
        try (PreparedStatement ps = c.prepareStatement("SELECT state, last_outcome::text FROM supply_release_ticks "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1")) {
            run(ps, s);
            try (ResultSet rs = ps.executeQuery()) {
                ObjectNode out = Demand.obj();
                if (!rs.next()) return out.put("status", "not-checked");
                JsonNode outcome = Demand.parse(rs.getString(2));
                if (outcome == null || outcome.isNull()) {
                    return out.put("status", "pending".equals(rs.getString(1)) ? "delayed" : "unavailable");
                }
                if ("ok".equals(outcome.path("status").asText(null))) return out.put("status", "ok");
                out.put("status", "unavailable");
                if ("stock-source-stale".equals(outcome.path("code").asText(null))) out.put("reason", "stale");
                return out;
            }
        } catch (SQLException | IOException | RuntimeException e) {
            c.rollback(sp);
            return Demand.obj().put("status", "evidence-unavailable");
        }
    }

    /** The briefs that decline decisions point to: one batched read of (employee, version) pairs. */
    static Map<String, JsonNode> briefContents(Connection c, DemandScope s, List<String> employees, List<Long> versions)
            throws SQLException, IOException {
        Map<String, JsonNode> out = new java.util.HashMap<>();
        if (employees.isEmpty()) return out;
        try (PreparedStatement ps = c.prepareStatement("SELECT b.employee_id, b.brief_version, b.content::text FROM briefs b "
                + "JOIN unnest(?::text[], ?::bigint[]) AS t(employee_id, brief_version) ON b.employee_id = t.employee_id "
                + "AND b.brief_version = t.brief_version WHERE b.environment_id = ? AND b.run_id = ?")) {
            ps.setArray(1, c.createArrayOf("text", employees.toArray()));
            ps.setArray(2, c.createArrayOf("int8", versions.toArray()));
            ps.setString(3, s.environmentId());
            ps.setString(4, s.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1) + "|" + rs.getLong(2), Demand.parse(rs.getString(3)));
            }
        }
        return out;
    }

    private static void run(PreparedStatement ps, DemandScope s) throws SQLException {
        ps.setString(1, s.environmentId());
        ps.setString(2, s.runId());
    }
}
