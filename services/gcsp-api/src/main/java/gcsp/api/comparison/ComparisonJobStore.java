package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.comparison.RetainedComparisonResults.Retained;
import gcsp.api.policy.PolicyClock;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;
import org.postgresql.util.PSQLException;

/** The comparison_jobs table: one running row per environment, terminal rows final (the database enforces both). */
final class ComparisonJobStore {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String COLUMNS = "job_id, experiment_id, status, seeds_done, seeds_total, steps_done, steps_total, "
            + "started_at, finished_at, result_id, reason, request::text, requested_by, command_id, input_digest, instance_id, version";

    enum Insert { INSERTED, BUSY, DUPLICATE_COMMAND }

    record Job(String jobId, String experimentId, String status, int seedsDone, int seedsTotal, int stepsDone, int stepsTotal,
            Instant startedAt, Instant finishedAt, String resultId, String reason, JsonNode request, String requestedBy,
            String commandId, String inputDigest, String instanceId, long version) {

        boolean running() {
            return "running".equals(status);
        }

        /** The browser view: no command, digest or instance details. */
        ObjectNode view() {
            ObjectNode out = JSON.createObjectNode();
            out.put("jobId", jobId);
            out.put("experimentId", experimentId);
            out.put("status", status);
            ObjectNode progress = out.putObject("progress");
            progress.put("seedsDone", seedsDone).put("seedsTotal", seedsTotal);
            progress.put("stepsDone", stepsDone).put("stepsTotal", stepsTotal);
            out.put("startedAt", PolicyClock.iso(startedAt));
            if (finishedAt == null) out.putNull("finishedAt"); else out.put("finishedAt", PolicyClock.iso(finishedAt));
            if (resultId == null) out.putNull("resultId"); else out.put("resultId", resultId);
            if (reason == null) out.putNull("reason"); else out.put("reason", reason);
            out.set("request", request.deepCopy());
            return out;
        }
    }

    private final DataSource dataSource;

    ComparisonJobStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** One statement; the partial unique index answers BUSY when this environment already has a running job. */
    Insert insertRunning(String environmentId, Job j) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "INSERT INTO comparison_jobs (environment_id, job_id, experiment_id, status, request, seeds_done, seeds_total, "
                        + "steps_done, steps_total, started_at, requested_by, command_id, input_digest, instance_id, version) "
                        + "VALUES (?, ?, ?, 'running', ?::jsonb, 0, ?, 0, ?, ?, ?, ?, ?, ?, 1)")) {
            ps.setString(1, environmentId);
            ps.setString(2, j.jobId());
            ps.setString(3, j.experimentId());
            ps.setString(4, j.request().toString());
            ps.setInt(5, j.seedsTotal());
            ps.setInt(6, j.stepsTotal());
            ps.setTimestamp(7, Timestamp.from(j.startedAt()));
            ps.setString(8, j.requestedBy());
            ps.setString(9, j.commandId());
            ps.setString(10, j.inputDigest());
            ps.setString(11, j.instanceId());
            ps.executeUpdate();
            return Insert.INSERTED;
        } catch (SQLException e) {
            if (!"23505".equals(e.getSQLState())) throw e;
            return constraint(e).contains("comparison_jobs_one_running") ? Insert.BUSY : Insert.DUPLICATE_COMMAND;
        }
    }

    private static String constraint(SQLException e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof PSQLException p && p.getServerErrorMessage() != null
                    && p.getServerErrorMessage().getConstraint() != null) {
                return p.getServerErrorMessage().getConstraint();
            }
        }
        return String.valueOf(e.getMessage());
    }

    /** Written after every step; a finished row is never touched. */
    void progress(String environmentId, String jobId, int seedsDone, int stepsDone) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "UPDATE comparison_jobs SET seeds_done = ?, steps_done = ?, version = version + 1 "
                        + "WHERE environment_id = ? AND job_id = ? AND status = 'running'")) {
            ps.setInt(1, seedsDone);
            ps.setInt(2, stepsDone);
            ps.setString(3, environmentId);
            ps.setString(4, jobId);
            ps.executeUpdate();
        }
    }

    /** Ends a running job as failed or interrupted; false when it was already finished. */
    boolean finish(String environmentId, String jobId, String status, String reason, Instant at) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "UPDATE comparison_jobs SET status = ?, reason = ?, finished_at = ?, version = version + 1 "
                        + "WHERE environment_id = ? AND job_id = ? AND status = 'running'")) {
            ps.setString(1, status);
            ps.setString(2, reason);
            ps.setTimestamp(3, Timestamp.from(at));
            ps.setString(4, environmentId);
            ps.setString(5, jobId);
            return ps.executeUpdate() == 1;
        }
    }

    /** Stores the result and marks the job succeeded in one transaction; a digest conflict stores nothing. */
    boolean succeed(String environmentId, String jobId, Retained result, Instant at) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                if (ComparisonStore.insert(c, environmentId, result, "run") == ComparisonStore.Inserted.CONFLICT) {
                    c.rollback();
                    return false;
                }
                boolean done;
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE comparison_jobs SET status = 'succeeded', result_id = ?, finished_at = ?, version = version + 1 "
                                + "WHERE environment_id = ? AND job_id = ? AND status = 'running'")) {
                    ps.setString(1, result.resultId());
                    ps.setTimestamp(2, Timestamp.from(at));
                    ps.setString(3, environmentId);
                    ps.setString(4, jobId);
                    done = ps.executeUpdate() == 1;
                }
                if (done) c.commit(); else c.rollback();
                return done;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /** Rows another instance left running can never finish; their progress counts stay as last written. */
    int interruptStale(String environmentId, String instanceId, String reason, Instant at) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "UPDATE comparison_jobs SET status = 'interrupted', reason = ?, finished_at = ?, version = version + 1 "
                        + "WHERE environment_id = ? AND status = 'running' AND instance_id <> ?")) {
            ps.setString(1, reason);
            ps.setTimestamp(2, Timestamp.from(at));
            ps.setString(3, environmentId);
            ps.setString(4, instanceId);
            return ps.executeUpdate();
        }
    }

    Optional<Job> byCommand(String environmentId, String requestedBy, String commandId) throws SQLException {
        return one("WHERE environment_id = ? AND requested_by = ? AND command_id = ?", environmentId, requestedBy, commandId);
    }

    Optional<Job> running(String environmentId) throws SQLException {
        return one("WHERE environment_id = ? AND status = 'running'", environmentId);
    }

    Optional<Job> byId(String environmentId, String jobId) throws SQLException {
        return one("WHERE environment_id = ? AND job_id = ?", environmentId, jobId);
    }

    Optional<Job> latest(String environmentId) throws SQLException {
        return one("WHERE environment_id = ? ORDER BY started_at DESC, job_id DESC LIMIT 1", environmentId);
    }

    private Optional<Job> one(String tail, String... params) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT " + COLUMNS + " FROM comparison_jobs " + tail)) {
            for (int i = 0; i < params.length; i++) ps.setString(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                Timestamp finished = rs.getTimestamp(9);
                return Optional.of(new Job(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4), rs.getInt(5),
                        rs.getInt(6), rs.getInt(7), rs.getTimestamp(8).toInstant(), finished == null ? null : finished.toInstant(),
                        rs.getString(10), rs.getString(11), JSON.readTree(rs.getString(12)), rs.getString(13), rs.getString(14),
                        rs.getString(15), rs.getString(16), rs.getLong(17)));
            }
        } catch (IOException e) {
            throw new SQLException("A stored comparison job is not valid JSON");
        }
    }
}
