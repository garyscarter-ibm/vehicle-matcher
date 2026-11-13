package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

/**
 * Dev-only run reset: checks the database's own identity, then retires the active run and activates a new one in
 * one transaction. Nothing is deleted (see docs/gcsp/java-persistence-design-2026-11-13.md, "Reset and isolation").
 */
public final class RunReset {

    private static final ObjectMapper JSON = new ObjectMapper();

    private record Receipt(String digest, String retiredRunId, String activatedRunId) {}

    private final DataSource dataSource;
    private final String expectedDatabase;
    private final String environmentId;

    public RunReset(DataSource dataSource, String expectedDatabase, String environmentId) {
        this.dataSource = dataSource;
        this.expectedDatabase = expectedDatabase == null ? "" : expectedDatabase.trim();
        this.environmentId = environmentId == null ? "" : environmentId.trim();
    }

    /** Committed result carries {retiredRunId, activatedRunId} at revision 0; replayed is true for a stored reset. */
    public Outcome reset(String targetEnvironmentId, String actorId, String commandId, String expectedActiveRunId,
            String newRunId) {
        if (blank(actorId) || blank(commandId) || blank(expectedActiveRunId) || blank(newRunId)) {
            return new Outcome.Refused("reset-input-invalid", "Actor, command and run ids are required");
        }
        String digest = digest(expectedActiveRunId, newRunId);
        Connection c = null;
        boolean commitStarted = false;
        try {
            c = dataSource.getConnection();
            c.setAutoCommit(false);
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);

            Outcome refusal = checkIsolation(c, targetEnvironmentId);
            if (refusal != null) {
                c.rollback();
                return refusal;
            }
            Receipt stored = readReceipt(c, commandId);
            if (stored != null) {
                c.rollback();
                return answer(stored, digest);
            }

            String active = lockActive(c);
            if (!expectedActiveRunId.equals(active)) {
                stored = readReceipt(c, commandId);
                c.rollback();
                if (stored != null) return answer(stored, digest);
                return new Outcome.Conflict("stale-run", "The active run is not the expected run", false);
            }
            retire(c, expectedActiveRunId);
            activate(c, newRunId);
            insertReceipt(c, actorId, commandId, digest, expectedActiveRunId, newRunId);
            commitStarted = true;
            c.commit();
            return new Outcome.Committed(result(expectedActiveRunId, newRunId), 0, false, true);
        } catch (Exception e) {
            if (commitStarted) return new Outcome.Uncertain(commandId);
            return failure(c, commandId, digest, e);
        } finally {
            close(c);
        }
    }

    /** After an uncertain outcome: did the reset commit? Absent means it is safe to resubmit. */
    public Inspection inspect(String commandId) {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            Receipt r = readReceipt(c, commandId);
            c.rollback();
            return r == null ? new Inspection.Absent()
                    : new Inspection.Committed(result(r.retiredRunId(), r.activatedRunId()), 0);
        } catch (Exception e) {
            return new Inspection.Unavailable("The database could not be reached");
        }
    }

    /** Database name, stored environment and reset_allowed must all match the configuration; null when they do. */
    private Outcome checkIsolation(Connection c, String targetEnvironmentId) throws SQLException {
        if (expectedDatabase.isEmpty() || environmentId.isEmpty()) {
            return new Outcome.Refused("reset-isolation-mismatch", "Reset is not configured for this deployment");
        }
        if (!environmentId.equals(targetEnvironmentId)) {
            return new Outcome.Refused("reset-isolation-mismatch", "The environment is not the configured one");
        }
        try (PreparedStatement ps = c.prepareStatement("SELECT current_database()");
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            if (!expectedDatabase.equals(rs.getString(1))) {
                return new Outcome.Refused("reset-isolation-mismatch", "The database is not the configured one");
            }
        }
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT environment_id, reset_allowed FROM environment_identity");
                ResultSet rs = ps.executeQuery()) {
            if (!rs.next() || !environmentId.equals(rs.getString(1))) {
                return new Outcome.Refused("reset-isolation-mismatch", "The database belongs to another environment");
            }
            if (!rs.getBoolean(2)) {
                return new Outcome.Refused("reset-not-allowed", "This database does not allow reset");
            }
        }
        return null;
    }

    private String lockActive(Connection c) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT run_id FROM runs WHERE environment_id = ? AND status = 'active' FOR UPDATE")) {
            ps.setString(1, environmentId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private void retire(Connection c, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("UPDATE runs SET status = 'retired', retired_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND status = 'active'")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.executeUpdate();
        }
    }

    private void activate(Connection c, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.executeUpdate();
        }
    }

    private void insertReceipt(Connection c, String actorId, String commandId, String digest, String retired,
            String activated) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO run_resets (environment_id, command_id, "
                + "actor_id, input_digest, retired_run_id, activated_run_id) VALUES (?, ?, ?, ?, ?, ?)")) {
            ps.setString(1, environmentId);
            ps.setString(2, commandId);
            ps.setString(3, actorId);
            ps.setString(4, digest);
            ps.setString(5, retired);
            ps.setString(6, activated);
            ps.executeUpdate();
        }
    }

    private Receipt readReceipt(Connection c, String commandId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT input_digest, retired_run_id, activated_run_id "
                + "FROM run_resets WHERE environment_id = ? AND command_id = ?")) {
            ps.setString(1, environmentId);
            ps.setString(2, commandId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Receipt(rs.getString(1), rs.getString(2), rs.getString(3)) : null;
            }
        }
    }

    private Outcome failure(Connection c, String commandId, String digest, Exception e) {
        rollbackQuietly(c);
        try {
            Receipt r = c == null ? null : readReceipt(c, commandId);
            rollbackQuietly(c);
            if (r != null) return answer(r, digest);
        } catch (SQLException ignored) {
            // fall through to the original failure
        }
        if (e instanceof SQLException sql) return TransactionRunner.mapSql(sql);
        if (e instanceof RuntimeException re) throw re;
        throw new IllegalStateException("Reset failed", e);
    }

    private static Outcome answer(Receipt r, String digest) {
        if (!r.digest().equals(digest)) {
            return new Outcome.Conflict("command-input-changed", "The command id was used with different input", false);
        }
        return new Outcome.Committed(result(r.retiredRunId(), r.activatedRunId()), 0, true, false);
    }

    private static JsonNode result(String retired, String activated) {
        ObjectNode n = JSON.createObjectNode();
        n.put("retiredRunId", retired);
        n.put("activatedRunId", activated);
        return n;
    }

    private static String digest(String expectedActiveRunId, String newRunId) {
        ObjectNode n = JSON.createObjectNode();
        n.put("expectedActiveRunId", expectedActiveRunId);
        n.put("newRunId", newRunId);
        return Canonical.digest(n);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static void rollbackQuietly(Connection c) {
        if (c == null) return;
        try {
            c.rollback();
        } catch (SQLException ignored) {
            // connection is unusable; close() follows
        }
    }

    private static void close(Connection c) {
        if (c == null) return;
        try {
            c.close();
        } catch (SQLException ignored) {
            // nothing more to do
        }
    }
}
