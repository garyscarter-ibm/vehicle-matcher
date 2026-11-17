package gcsp.api.supply;

import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** Confirmed Production supply in the database: one primary-key set query per pull, scoped to the environment and run. */
public final class PostgresConfirmedSupplyLookup implements ConfirmedSupplyLookup {

    static final String SQL = "SELECT c.supply_id, r.model, r.derivative, c.quantity FROM production_confirmations c "
            + "JOIN production_requests r ON r.environment_id = c.environment_id AND r.run_id = c.run_id "
            + "AND r.request_id = c.request_id WHERE c.environment_id = ? AND c.run_id = ? AND c.supply_id = ANY(?)";

    private final Supplier<DataSource> dataSource;
    private final Supplier<String> environmentId;

    public PostgresConfirmedSupplyLookup(Supplier<DataSource> dataSource, Supplier<String> environmentId) {
        this.dataSource = dataSource;
        this.environmentId = environmentId;
    }

    @Override
    public Map<String, Confirmed> find(String runId, Collection<String> supplyIds) {
        Map<String, Confirmed> found = new HashMap<>();
        if (supplyIds.isEmpty()) return found;
        String environment = environmentId.get();
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(SQL)) {
            ps.setString(1, environment);
            ps.setString(2, runId);
            Array ids = c.createArrayOf("text", supplyIds.toArray());
            try {
                ps.setArray(3, ids);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        found.put(rs.getString(1), new Confirmed(rs.getString(2), rs.getString(3), rs.getInt(4)));
                    }
                }
            } finally {
                ids.free();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Confirmed supply could not be read", e);
        }
        return found;
    }
}
