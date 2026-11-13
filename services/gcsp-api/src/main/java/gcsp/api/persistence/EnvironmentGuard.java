package gcsp.api.persistence;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

/** Startup identity check: right database, right environment; claims an empty database with its first run. */
public final class EnvironmentGuard {

    /** The active run as stored right now. */
    public record RunState(String environmentId, String runId, long revision) {}

    public static final String FIRST_RUN_ID = "run-1";

    private final DataSource dataSource;
    private final String expectedDatabase;
    private final String environmentId;
    private final boolean resetAllowed;

    public EnvironmentGuard(DataSource dataSource, String expectedDatabase, String environmentId,
            boolean resetAllowed) {
        this.dataSource = dataSource;
        this.expectedDatabase = expectedDatabase == null ? "" : expectedDatabase.trim();
        this.environmentId = environmentId == null ? "" : environmentId.trim();
        this.resetAllowed = resetAllowed;
    }

    /** Verifies the database and environment, claiming the identity and first run when the database is empty. */
    public RunState claim() {
        if (expectedDatabase.isEmpty()) throw new EnvironmentMismatchException("GCSP_EXPECTED_DATABASE is not set");
        if (environmentId.isEmpty()) throw new EnvironmentMismatchException("GCSP_ENVIRONMENT_ID is not set");
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            String actual = scalar(c, "SELECT current_database()");
            if (!expectedDatabase.equals(actual)) {
                throw new EnvironmentMismatchException("Connected database '" + actual
                        + "' does not match GCSP_EXPECTED_DATABASE '" + expectedDatabase + "'");
            }
            boolean claimed = false;
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO environment_identity "
                    + "(environment_id, reset_allowed) VALUES (?, ?) ON CONFLICT (singleton) DO NOTHING")) {
                ps.setString(1, environmentId);
                ps.setBoolean(2, resetAllowed);
                claimed = ps.executeUpdate() == 1;
            }
            if (claimed) {
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO runs (environment_id, run_id, status) "
                        + "VALUES (?, ?, 'active')")) {
                    ps.setString(1, environmentId);
                    ps.setString(2, FIRST_RUN_ID);
                    ps.executeUpdate();
                }
            } else {
                String stored = scalar(c, "SELECT environment_id FROM environment_identity");
                if (!environmentId.equals(stored)) {
                    throw new EnvironmentMismatchException("Database belongs to environment '" + stored
                            + "' but GCSP_ENVIRONMENT_ID is '" + environmentId + "'");
                }
            }
            c.commit();
        } catch (SQLException e) {
            throw new IllegalStateException("Environment check could not read the database (SQLState "
                    + e.getSQLState() + ")");
        }
        return currentRun();
    }

    /** Selected read of the active run and its revision. */
    public RunState currentRun() {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT environment_id, run_id, revision FROM runs "
                        + "WHERE environment_id = ? AND status = 'active'")) {
            ps.setString(1, environmentId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new IllegalStateException("No active run for environment " + environmentId);
                return new RunState(rs.getString(1), rs.getString(2), rs.getLong(3));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Active run could not be read (SQLState " + e.getSQLState() + ")");
        }
    }

    private static String scalar(Connection c, String sql) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        }
    }
}
