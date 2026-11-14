package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;

/** Bounded reads of release state: the allocator's released-car pages, the latest receipt and tick inspection. */
public final class ReleasedStock {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";
    static final String TICK_COLUMNS = "tick_id, tick_now, clock_version, input_digest, state, attempts, version, "
            + "delivered_seq, last_outcome::text";

    private final DataSource dataSource;

    public ReleasedStock(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** Keyset page over released cars in orderUuid order; pass the last orderUuid (or null) to continue. */
    public List<ReleasedCar> page(RunContext scope, String afterOrderUuid, int limit) throws SQLException {
        if (limit <= 0) throw new IllegalArgumentException("limit must be positive");
        String sql = "SELECT c.order_uuid, c.configuration_id, c.version, c.attributes::text, EXISTS (SELECT 1 FROM "
                + "custody_holds h WHERE h.environment_id = c.environment_id AND h.run_id = c.run_id "
                + "AND h.order_uuid = c.order_uuid AND h.state IN " + OCCUPYING + ") "
                + "FROM stock_cars c WHERE c.environment_id = ? AND c.run_id = ? AND c.state = 'released' "
                + "AND c.order_uuid > ? ORDER BY c.order_uuid LIMIT ?";
        List<ReleasedCar> cars = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, afterOrderUuid == null ? "" : afterOrderUuid);
            ps.setInt(4, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    cars.add(new ReleasedCar(rs.getString(1), rs.getString(2), rs.getLong(3), json(rs.getString(4)),
                            rs.getBoolean(5)));
                }
            }
        }
        return cars;
    }

    /** The most recent tranche receipt for the run, if any. */
    public Optional<ReleaseReceipt> latest(RunContext scope) throws SQLException {
        String sql = "SELECT tranche_id, window_id, supply_id, tick_id, released_at, policy_version, source::text, "
                + "order_uuids::text, visible_order_uuids::text, outcome::text FROM stock_releases "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY released_at DESC, tranche_id DESC LIMIT 1";
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(new ReleaseReceipt(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getObject(5, OffsetDateTime.class).toInstant(), rs.getString(6),
                        json(rs.getString(7)), json(rs.getString(8)), json(rs.getString(9)), json(rs.getString(10))));
            }
        }
    }

    /** Tick inspection by its primary key. */
    public Optional<TickRow> tick(RunContext scope, String tickId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return readTick(c, scope, tickId);
        }
    }

    static Optional<TickRow> readTick(Connection c, RunContext scope, String tickId) throws SQLException {
        String sql = "SELECT " + TICK_COLUMNS + " FROM supply_release_ticks "
                + "WHERE environment_id = ? AND run_id = ? AND tick_id = ?";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, tickId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(tickRow(rs)) : Optional.empty();
            }
        }
    }

    static TickRow tickRow(ResultSet rs) throws SQLException {
        String outcome = rs.getString(9);
        return new TickRow(rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getLong(3),
                rs.getString(4), rs.getString(5), rs.getInt(6), rs.getLong(7), rs.getLong(8),
                outcome == null ? null : json(outcome));
    }

    static JsonNode json(String text) throws SQLException {
        try {
            return JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }
}
