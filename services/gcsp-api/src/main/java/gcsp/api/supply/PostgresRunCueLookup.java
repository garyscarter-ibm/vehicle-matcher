package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** The run clock's stored named times, by primary key; the run's dated release cue, not the policy template's. */
public final class PostgresRunCueLookup implements RunCueLookup {

    static final String SQL = "SELECT named_times::text FROM run_clocks WHERE environment_id = ? AND run_id = ?";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Supplier<DataSource> dataSource;
    private final Supplier<String> environmentId;

    public PostgresRunCueLookup(Supplier<DataSource> dataSource, Supplier<String> environmentId) {
        this.dataSource = dataSource;
        this.environmentId = environmentId;
    }

    @Override
    public Map<String, Instant> namedTimes(String runId) {
        Map<String, Instant> out = new HashMap<>();
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(SQL)) {
            ps.setString(1, environmentId.get());
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return out;
                JsonNode stored = JSON.readTree(rs.getString(1));
                stored.fields().forEachRemaining(e -> {
                    Instant at = e.getValue().isTextual() ? Iso.parse(e.getValue().asText()) : null;
                    if (at != null) out.put(e.getKey(), at);
                });
            }
        } catch (SQLException | IOException e) {
            throw new IllegalStateException("The run clock could not be read", e);
        }
        return out;
    }
}
