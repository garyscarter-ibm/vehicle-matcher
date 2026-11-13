package gcsp.api.persistence;

import java.sql.SQLException;
import java.time.Instant;

/** Explicit-SQL custody primitives: setup rows, hold acquire and release. Business rules live elsewhere. */
public final class Custody {

    private Custody() {}

    public static void insertEmployee(Tx tx, String employeeId) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?)",
                c.environmentId(), c.runId(), employeeId);
    }

    public static void insertSlot(Tx tx, String slotId, String employeeId, int capacity) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, ?)", c.environmentId(), c.runId(), slotId, employeeId, capacity);
    }

    public static void insertStockCar(Tx tx, String orderUuid, String configurationId, String state)
            throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, ?, ?, ?)", c.environmentId(), c.runId(), orderUuid, configurationId, state);
    }

    /**
     * Inserts the hold first so the unique indexes decide competing writers (car-held, slot-occupied), then
     * bumps the car version by CAS (stale-version if it moved since the caller read it).
     */
    public static void acquireHold(Tx tx, String holdId, String orderUuid, long expectedCarVersion, String slotId,
            String employeeId, int slotUnit, Instant expiresAt) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, "
                + "slot_unit, hold_type, state, expires_at, operation_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 'cart', 'active', ?, ?)",
                c.environmentId(), c.runId(), holdId, orderUuid, employeeId, slotId, slotUnit, expiresAt,
                tx.commandId());
        tx.cas("UPDATE stock_cars SET version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?",
                c.environmentId(), c.runId(), orderUuid, expectedCarVersion);
    }

    /** Moves an occupying hold to released by CAS on its version. */
    public static void releaseHold(Tx tx, String holdId, long expectedHoldVersion) throws SQLException {
        RunContext c = tx.context();
        tx.cas("UPDATE custody_holds SET state = 'released', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state IN ('active', 'claim-pending', 'release-pending', 'selection-pending')",
                c.environmentId(), c.runId(), holdId, expectedHoldVersion);
    }

    public static long carVersion(Tx tx, String orderUuid) throws SQLException {
        RunContext c = tx.context();
        return tx.first("SELECT version FROM stock_cars WHERE environment_id = ? AND run_id = ? AND order_uuid = ?",
                rs -> rs.getLong(1), c.environmentId(), c.runId(), orderUuid).orElseThrow(
                        () -> new TxConflict("car-not-found", "No such car"));
    }
}
