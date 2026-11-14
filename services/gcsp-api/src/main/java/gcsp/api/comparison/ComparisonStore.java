package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.comparison.RetainedComparisonResults.Retained;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/** The immutable comparison_results table: idempotent inserts and bounded latest-per-experiment reads. */
public final class ComparisonStore {

    private static final ObjectMapper JSON = new ObjectMapper();

    public enum Inserted { NEW, SAME, CONFLICT }

    public record Stored(String resultId, String experimentId, Instant storedAt, String policyVersion, String digest,
            String origin, JsonNode result) {}

    private static final String COLUMNS = "result_id, experiment_id, stored_at, policy_version, result_digest, origin, result::text";

    private final DataSource dataSource;

    public ComparisonStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** NEW when stored; SAME when the id already holds this digest; CONFLICT when it holds another (left unchanged). */
    public Inserted insert(String environmentId, Retained r, String origin) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO comparison_results (environment_id, result_id, "
                    + "experiment_id, kind, completed_at, policy_version, result_digest, origin, result) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (environment_id, result_id) DO NOTHING")) {
                ps.setString(1, environmentId);
                ps.setString(2, r.resultId());
                ps.setString(3, r.experimentId());
                ps.setString(4, r.kind());
                ps.setTimestamp(5, Timestamp.from(r.completedAt()));
                ps.setString(6, r.policyVersion());
                ps.setString(7, r.digest());
                ps.setString(8, origin);
                ps.setString(9, r.result().toString());
                if (ps.executeUpdate() == 1) return Inserted.NEW;
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT result_digest FROM comparison_results WHERE environment_id = ? AND result_id = ?")) {
                ps.setString(1, environmentId);
                ps.setString(2, r.resultId());
                try (ResultSet rs = ps.executeQuery()) {
                    return rs.next() && r.digest().equals(rs.getString(1)) ? Inserted.SAME : Inserted.CONFLICT;
                }
            }
        }
    }

    /** The newest result of one experiment: completed_at then result_id, descending. */
    public Optional<Stored> latest(String environmentId, String experimentId) throws SQLException {
        return query("SELECT " + COLUMNS + " FROM comparison_results WHERE environment_id = ? AND experiment_id = ? "
                + "ORDER BY completed_at DESC, result_id DESC LIMIT 1", environmentId, experimentId)
                .values().stream().findFirst();
    }

    /** The newest result of every experiment that has one, in one query over the latest-result index. */
    public Map<String, Stored> latestAll(String environmentId) throws SQLException {
        return query("SELECT DISTINCT ON (experiment_id) " + COLUMNS + " FROM comparison_results WHERE environment_id = ? "
                + "ORDER BY experiment_id, completed_at DESC, result_id DESC", environmentId);
    }

    private Map<String, Stored> query(String sql, String... params) throws SQLException {
        Map<String, Stored> out = new LinkedHashMap<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setString(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Stored s = new Stored(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant(),
                            rs.getString(4), rs.getString(5), rs.getString(6), JSON.readTree(rs.getString(7)));
                    out.put(s.experimentId(), s);
                }
            }
        } catch (IOException e) {
            throw new SQLException("A stored comparison result is not valid JSON");
        }
        return out;
    }
}
