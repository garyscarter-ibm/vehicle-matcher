package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The fixed snapshot reads behind the presenter suitability view; each is bounded by the page, never the run. */
final class SuitabilityStore {

    /** An engaged buddy: the latest confirmed brief with the employee row it belongs to. */
    record Buddy(String employeeId, String name, long briefVersion, long employeeVersion, Long permissionVersion) {}

    /** The page's car: only the fields the view shows. */
    record PageCar(String orderUuid, String state, String displayName, String modelLine, String colour, String orderNumber,
            JsonNode availability) {}

    record PageHold(String orderUuid, String employeeId, String type, String state) {}

    /** The name parts of one employee. */
    record Person(String name, String firstName, String lastName) {}

    private static final String TEXT = "CASE WHEN jsonb_typeof(%s) = 'string' THEN (%s) #>> '{}' END";

    private SuitabilityStore() {}

    private static String text(String expr) {
        return String.format(TEXT, expr, expr);
    }

    /** Order ids of the releases, newest release first; the latest alone when asked. */
    static List<String> releasedIds(Connection c, DemandScope s, boolean latest) throws SQLException, IOException {
        try (PreparedStatement ps = c.prepareStatement("SELECT tranche_id, released_at, order_uuids::text FROM stock_releases "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY released_at DESC, tranche_id DESC" + (latest ? " LIMIT 1" : ""))) {
            run(ps, s);
            List<String> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    JsonNode ids = Demand.parse(rs.getString(3));
                    if (ids == null || !ids.isArray()) throw new IOException("order_uuids is not an array");
                    for (JsonNode id : ids) {
                        if (!id.isTextual()) throw new IOException("order id is not text");
                        out.add(id.asText());
                    }
                }
            }
            return out;
        }
    }

    /** How many of these ids have a stock row; a release id without one makes the view unreadable. */
    static long existing(Connection c, DemandScope s, List<String> ids) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ANY(?)")) {
            run(ps, s);
            ps.setArray(3, c.createArrayOf("text", ids.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    /** The latest confirmed brief of every engaged employee whose employee row exists. */
    static List<Buddy> engaged(Connection c, DemandScope s) throws SQLException {
        String name = text("e.attributes -> 'name'");
        String first = text("e.attributes -> 'firstName'");
        String last = text("e.attributes -> 'lastName'");
        try (PreparedStatement ps = c.prepareStatement("SELECT h.employee_id, b.brief_version, e.version, " + name + ", " + first
                + ", " + last + ", CASE WHEN jsonb_typeof(b.buddy -> 'permissionVersion') = 'number' "
                + "THEN (b.buddy ->> 'permissionVersion')::numeric::bigint END "
                + "FROM brief_heads h JOIN briefs b ON b.environment_id = h.environment_id AND b.run_id = h.run_id "
                + "AND b.employee_id = h.employee_id AND b.brief_version = h.brief_version "
                + "JOIN employees e ON e.environment_id = h.environment_id AND e.run_id = h.run_id AND e.employee_id = h.employee_id "
                + "WHERE h.environment_id = ? AND h.run_id = ? AND h.brief_version > 0 "
                + "AND b.buddy @> '{\"searchConsent\":true,\"holdConsent\":true,\"paused\":false}'::jsonb")) {
            run(ps, s);
            List<Buddy> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long permission = rs.getLong(7);
                    Long permissionVersion = rs.wasNull() ? null : permission;
                    out.add(new Buddy(rs.getString(1), SuitabilityService.nameOf(rs.getString(1), new Person(rs.getString(4),
                            rs.getString(5), rs.getString(6))), rs.getLong(2), rs.getLong(3), permissionVersion));
                }
            }
            return out;
        }
    }

    static Map<String, PageCar> cars(Connection c, DemandScope s, List<String> ids) throws SQLException, IOException {
        try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid, state, " + text("attributes #> '{facts,display,name}'")
                + ", " + text("attributes #> '{facts,facts,modelLine,value}'") + ", " + text("attributes #> '{facts,facts,colour,value}'")
                + ", " + text("attributes -> 'orderNumber'") + ", (attributes #> '{release,availability}')::text FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY(?)")) {
            run(ps, s);
            ps.setArray(3, c.createArrayOf("text", ids.toArray()));
            Map<String, PageCar> out = new HashMap<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.put(rs.getString(1), new PageCar(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                            rs.getString(5), rs.getString(6), Demand.parse(rs.getString(7))));
                }
            }
            return out;
        }
    }

    /** Holds that occupy a page car, or allocate it; released, expired and failed claims are not occupancy. */
    static List<PageHold> holds(Connection c, DemandScope s, List<String> ids) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid, employee_id, hold_type, state FROM custody_holds "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY(?) AND state IN ('active', 'claim-pending', "
                + "'release-pending', 'selection-pending', 'allocated')")) {
            run(ps, s);
            ps.setArray(3, c.createArrayOf("text", ids.toArray()));
            List<PageHold> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(new PageHold(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)));
            }
            return out;
        }
    }

    /** Name parts of the named employees; one that has no row is simply absent. */
    static Map<String, Person> people(Connection c, DemandScope s, List<String> ids) throws SQLException {
        Map<String, Person> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        try (PreparedStatement ps = c.prepareStatement("SELECT e.employee_id, " + text("e.attributes -> 'name'") + ", "
                + text("e.attributes -> 'firstName'") + ", " + text("e.attributes -> 'lastName'") + " FROM employees e "
                + "WHERE e.environment_id = ? AND e.run_id = ? AND e.employee_id = ANY(?)")) {
            run(ps, s);
            ps.setArray(3, c.createArrayOf("text", ids.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), new Person(rs.getString(2), rs.getString(3), rs.getString(4)));
            }
        }
        return out;
    }

    private static void run(PreparedStatement ps, DemandScope s) throws SQLException {
        ps.setString(1, s.environmentId());
        ps.setString(2, s.runId());
    }
}
