package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * The current-car relationship per exact order (ports current-car/index.js). Only a confirmed handover completion or
 * return changes it. Every statement keys on the order's primary key, so nothing scans a run.
 */
public final class CurrentCarStore implements CurrentCarPort {

    private static final String REL_COLUMNS = "employee_id, old_contract_id, old_slot_id, old_status, old_returned_at, "
            + "old_provider_reference, old_location::text, new_configuration_id, new_status, new_collected_at, new_vin, "
            + "new_provider_reference, version";
    private static final String READ_REL = "SELECT " + REL_COLUMNS + " FROM current_car_relationships "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?";
    private static final String READ_EVENT = "SELECT input_digest FROM current_car_events "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND event_type = ?";
    private static final String READ_EVENTS = "SELECT payload::text FROM current_car_events "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? ORDER BY occurred_at, event_type";

    private record Row(String employeeId, CurrentCarView.Old old, CurrentCarView.New current, long version) {}

    private final DataSource dataSource;

    public CurrentCarStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public CurrentCarResult apply(Tx tx, CurrentCarEvent e, ReturnSource source) throws SQLException {
        String problem = e == null ? "Supply the confirmed event." : e.problem();
        if (problem != null) return refused("invalid-current-car-event", problem);
        if (source == null || !e.orderUuid().equals(source.orderUuid())) {
            return refused("invalid-current-car-event", "The event is not for this order.");
        }
        if (!source.employeeId().equals(e.employeeId())) return refused("forbidden", "This order belongs to another employee.");
        if (e.isReturn() && !source.applicable()) {
            return refused("return-not-applicable", "A new order has no current car to return.");
        }
        if (e.isReturn() && !e.oldContractId().equals(source.oldContractId())) {
            return refused("current-car-identity-mismatch", "The returned car is not the car this order replaces.");
        }
        RunContext c = tx.context();
        String digest = Canonical.digest(e.payload());
        Optional<String> prior = tx.first(READ_EVENT, rs -> rs.getString(1), c.environmentId(), c.runId(), e.orderUuid(),
                e.type());
        Row row = relationship(tx.connection(), c, e.orderUuid());
        if (prior.isPresent()) {
            if (!prior.get().equals(digest)) {
                return refused("idempotency-input-changed", "This event was already recorded differently.");
            }
            return new CurrentCarResult.Applied(false, view(tx.connection(), c, e.orderUuid(), source, row));
        }
        if (row == null) {
            insertBaseline(tx, c, source);
            row = relationship(tx.connection(), c, e.orderUuid());
        }
        tx.write("INSERT INTO current_car_events (environment_id, run_id, order_uuid, event_type, input_digest, "
                + "occurred_at, provider_reference, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", c.environmentId(), c.runId(),
                e.orderUuid(), e.type(), digest, e.occurredAt(), e.providerReference(), e.payload());
        if (e.isReturn()) {
            tx.cas("UPDATE current_car_relationships SET old_status = 'returned', old_returned_at = ?, "
                    + "old_provider_reference = ?, old_location = ?, version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?", e.occurredAt(),
                    e.providerReference(), e.location() == null || e.location().isNull() ? null : e.location(),
                    c.environmentId(), c.runId(), e.orderUuid(), row.version());
        } else {
            tx.cas("UPDATE current_car_relationships SET new_status = 'collected', new_collected_at = ?, new_vin = ?, "
                    + "new_provider_reference = ?, version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?", e.occurredAt(), e.vin(),
                    e.providerReference(), c.environmentId(), c.runId(), e.orderUuid(), row.version());
        }
        Row next = relationship(tx.connection(), c, e.orderUuid());
        return new CurrentCarResult.Applied(true, view(tx.connection(), c, e.orderUuid(), source, next));
    }

    @Override
    public CurrentCarView read(RunContext ctx, String orderUuid, ReturnSource source) throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            conn.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            conn.setReadOnly(true);
            try {
                Row row = relationship(conn, ctx, orderUuid);
                return view(conn, ctx, orderUuid, source, row);
            } finally {
                conn.rollback();
            }
        }
    }

    private static CurrentCarResult.Refused refused(String code, String message) {
        return new CurrentCarResult.Refused(code, message);
    }

    /** The relationship the selection implies before any confirmed event: old car held, new car on order. */
    private static Row baseline(ReturnSource s) {
        CurrentCarView.Old old = s.applicable()
                ? new CurrentCarView.Old(s.oldContractId(), s.oldSlotId(), "held", null, null, null) : null;
        return new Row(s.employeeId(), old,
                new CurrentCarView.New(s.orderUuid(), s.configurationId(), "on-order", null, null, null), 0);
    }

    private static void insertBaseline(Tx tx, RunContext c, ReturnSource s) throws SQLException {
        tx.write("INSERT INTO current_car_relationships (environment_id, run_id, order_uuid, employee_id, "
                + "old_contract_id, old_slot_id, old_status, new_configuration_id, new_status) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'on-order')", c.environmentId(), c.runId(), s.orderUuid(),
                s.employeeId(), s.applicable() ? s.oldContractId() : null, s.applicable() ? s.oldSlotId() : null,
                s.applicable() ? "held" : null, s.configurationId());
    }

    private static Row relationship(Connection conn, RunContext c, String orderUuid) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(READ_REL)) {
            ps.setString(1, c.environmentId());
            ps.setString(2, c.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String oldStatus = rs.getString("old_status");
                CurrentCarView.Old old = oldStatus == null ? null
                        : new CurrentCarView.Old(rs.getString("old_contract_id"), rs.getString("old_slot_id"), oldStatus,
                                instant(rs, "old_returned_at"), rs.getString("old_provider_reference"),
                                json(rs.getString("old_location")));
                CurrentCarView.New created = new CurrentCarView.New(orderUuid, rs.getString("new_configuration_id"),
                        rs.getString("new_status"), instant(rs, "new_collected_at"), rs.getString("new_vin"),
                        rs.getString("new_provider_reference"));
                return new Row(rs.getString("employee_id"), old, created, rs.getLong("version"));
            }
        }
    }

    private static CurrentCarView view(Connection conn, RunContext c, String orderUuid, ReturnSource source, Row row)
            throws SQLException {
        Row r = row == null ? baseline(source) : row;
        List<CurrentCarView.Change> changes = new ArrayList<>();
        if (row != null) {
            try (PreparedStatement ps = conn.prepareStatement(READ_EVENTS)) {
                ps.setString(1, c.environmentId());
                ps.setString(2, c.runId());
                ps.setString(3, orderUuid);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        JsonNode p = json(rs.getString(1));
                        changes.add(new CurrentCarView.Change(p.path("type").asText(),
                                ReturnJson.parse(p.path("occurredAt").asText(null)), p.path("providerReference").asText(),
                                p.path("appointment")));
                    }
                }
            }
        }
        return new CurrentCarView(c.runId(), orderUuid, r.employeeId(), r.old(), r.current(), changes);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    private static JsonNode json(String text) throws SQLException {
        if (text == null) return null;
        try {
            return ReturnJson.JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored current-car record is unreadable");
        }
    }
}
