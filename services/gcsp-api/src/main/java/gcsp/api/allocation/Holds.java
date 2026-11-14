package gcsp.api.allocation;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

/** Bounded custody reads shared by prepare and claim: per employee, per slot and per renewal, never per history. */
final class Holds {

    /** What one employee's holds say about their slot (occupying or allocated). */
    record Employee(int occupying, int slotOccupying, int slotAllocated) {}

    private Holds() {}

    static Employee employee(Connection c, RunContext x, String employeeId, String slotId) throws SQLException {
        String sql = "SELECT count(*) FILTER (WHERE state IN " + Buddy.OCCUPYING + "), "
                + "count(*) FILTER (WHERE slot_id = ? AND state IN " + Buddy.OCCUPYING + "), "
                + "count(*) FILTER (WHERE slot_id = ? AND state = 'allocated') FROM custody_holds "
                + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?";
        return Sql.one(c, sql, rs -> new Employee(rs.getInt(1), rs.getInt(2), rs.getInt(3)), slotId, slotId,
                x.environmentId(), x.runId(), employeeId);
    }

    /** True when a hold carrying this renewal id is allocated, or (with occupying) occupying too. */
    static boolean renewalHeld(Connection c, RunContext x, String renewalId, boolean occupying) throws SQLException {
        if (renewalId == null) return false;
        String sql = "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? AND attributes->>'renewalId' = ? "
                + "AND (state = 'allocated'" + (occupying ? " OR state IN " + Buddy.OCCUPYING : "") + ") LIMIT 1";
        return Sql.one(c, sql, rs -> 1, x.environmentId(), x.runId(), renewalId) != null;
    }

    static boolean carHeld(Connection c, RunContext x, String orderUuid) throws SQLException {
        String sql = "SELECT 1 FROM custody_holds WHERE environment_id = ? AND run_id = ? AND order_uuid = ? "
                + "AND (state IN " + Buddy.OCCUPYING + " OR state = 'allocated') LIMIT 1";
        return Sql.one(c, sql, rs -> 1, x.environmentId(), x.runId(), orderUuid) != null;
    }

    static List<Integer> occupiedUnits(Connection c, RunContext x, String slotId) throws SQLException {
        return Sql.query(c, "SELECT slot_unit FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND slot_id = ? AND state IN " + Buddy.OCCUPYING, rs -> rs.getInt(1), x.environmentId(), x.runId(),
                slotId);
    }
}
