package gcsp.api.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;

/** Exactly one retained version on the caller's snapshot connection; never initializes policy or writes. */
public final class PinnedPolicySnapshot {
    private PinnedPolicySnapshot() {}

    public static PolicyService read(Connection c, RunContext scope, String version) throws SQLException {
        String sql = "SELECT v.policy_version, v.effective_from, v.seed_digest, d.document::text "
                + "FROM policy_versions v JOIN policy_documents d ON d.seed_digest = v.seed_digest "
                + "WHERE v.environment_id = ? AND v.run_id = ? AND v.policy_version = ?";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, version);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new SQLException("The release policy is unavailable", "P0002");
                try {
                    var header = new PolicyRecords.Header(rs.getString(1),
                            rs.getObject(2, OffsetDateTime.class).toInstant().toEpochMilli(), rs.getString(3));
                    var seeds = List.<com.fasterxml.jackson.databind.JsonNode>of(PolicyRecords.verified(header,
                            new ObjectMapper().readTree(rs.getString(4))));
                    return new PolicyService(run -> {
                        if (!scope.runId().equals(run)) throw new PolicySourceException(PolicySourceException.INVALID);
                        return seeds;
                    });
                } catch (java.io.IOException | PolicySourceException e) {
                    throw new SQLException("The release policy is invalid", "P0002", e);
                }
            }
        }
    }
}
