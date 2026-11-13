package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.postgresql.util.PSQLException;

/**
 * Runs one short READ COMMITTED transaction per command: receipt check, explicit SQL, then revision bump,
 * receipt and outbox rows, commit (see docs/gcsp/java-persistence-design-2026-11-13.md, "Command transaction").
 */
public final class TransactionRunner {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String RECEIPT_SQL = "SELECT input_digest, result::text, run_revision FROM command_receipts "
            + "WHERE environment_id = ? AND run_id = ? AND actor_id = ? AND command_id = ?";

    private record Receipt(String digest, JsonNode result, long revision) {}

    private final DataSource dataSource;

    public TransactionRunner(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Outcome execute(RunContext ctx, Command cmd, Work work) {
        String digest = Canonical.digest(cmd.input());
        Connection c = null;
        boolean commitStarted = false;
        try {
            c = dataSource.getConnection();
            c.setAutoCommit(false);
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);

            Receipt existing = readReceipt(c, ctx, cmd.commandId());
            if (existing != null) {
                c.rollback();
                return answer(existing, digest);
            }

            // Refuse a retired run before its work can hit constraints; the final bump still guards a racing reset.
            if (!runActive(c, ctx)) {
                c.rollback();
                return new Outcome.Conflict("stale-run", "The run is retired or does not exist", false);
            }

            Tx tx = new Tx(c, ctx, cmd.commandId());
            WorkResult wr = work.run(tx);
            if (wr instanceof WorkResult.Refuse refuse) {
                c.rollback();
                return new Outcome.Refused(refuse.code(), refuse.message());
            }
            JsonNode result = ((WorkResult.Ok) wr).result();
            if (result == null) result = JSON.nullNode();

            if (!tx.changed()) {
                long revision = currentRevision(c, ctx);
                c.rollback();
                return new Outcome.Committed(result, revision, false, false);
            }

            long revision = bumpRevision(c, ctx);
            insertReceipt(c, ctx, cmd, digest, result, revision);
            for (Tx.Event e : tx.events()) insertEvent(c, ctx, cmd, e, revision);
            commitStarted = true;
            c.commit();
            return new Outcome.Committed(result, revision, false, true);
        } catch (Exception e) {
            if (commitStarted) return new Outcome.Uncertain(cmd.commandId());
            return failure(ctx, cmd, digest, c, e);
        } finally {
            close(c);
        }
    }

    /** After an uncertain outcome: did the command commit? Absent means it is safe to resubmit. */
    public Inspection inspect(RunContext ctx, String commandId) {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            Receipt r = readReceipt(c, ctx, commandId);
            c.rollback();
            return r == null ? new Inspection.Absent() : new Inspection.Committed(r.result(), r.revision());
        } catch (Exception e) {
            return new Inspection.Unavailable("The database could not be reached");
        }
    }

    private Outcome failure(RunContext ctx, Command cmd, String digest, Connection c, Exception e) {
        rollbackQuietly(c);
        try {
            Receipt r = c == null ? null : readReceipt(c, ctx, cmd.commandId());
            rollbackQuietly(c);
            if (r != null) return answer(r, digest);
        } catch (SQLException ignored) {
            // fall through to the original failure
        }
        if (e instanceof TxConflict tc) {
            return new Outcome.Conflict(tc.code(), tc.getMessage(), "stale-version".equals(tc.code()));
        }
        if (e instanceof SQLException sql) return mapSql(sql);
        if (e instanceof RuntimeException re) throw re;
        throw new IllegalStateException("Command work failed", e);
    }

    static Outcome mapSql(SQLException e) {
        String state = e.getSQLState();
        String constraint = e instanceof PSQLException p && p.getServerErrorMessage() != null
                ? p.getServerErrorMessage().getConstraint()
                : null;
        if ("23505".equals(state)) {
            if ("custody_holds_one_per_car".equals(constraint)) {
                return new Outcome.Conflict("car-held", "The car is already held", false);
            }
            if ("custody_holds_one_per_slot_unit".equals(constraint)) {
                return new Outcome.Conflict("slot-occupied", "The slot unit is already occupied", false);
            }
            return new Outcome.Conflict("duplicate-record", "A record with this identity already exists", false);
        }
        if ("23514".equals(state)) {
            return new Outcome.Refused("constraint-violated", "The change breaks a data rule");
        }
        if ("23503".equals(state)) {
            return new Outcome.Refused("reference-missing", "A referenced record does not exist");
        }
        return new Outcome.Unavailable("The database could not complete the request");
    }

    private static Outcome answer(Receipt r, String digest) {
        if (!r.digest().equals(digest)) {
            return new Outcome.Conflict("command-input-changed", "The command id was used with different input", false);
        }
        return new Outcome.Committed(r.result(), r.revision(), true, false);
    }

    private static Receipt readReceipt(Connection c, RunContext ctx, String commandId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(RECEIPT_SQL)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, ctx.actorId());
            ps.setString(4, commandId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                try {
                    return new Receipt(rs.getString(1), JSON.readTree(rs.getString(2)), rs.getLong(3));
                } catch (java.io.IOException e) {
                    throw new SQLException("Stored receipt is unreadable");
                }
            }
        }
    }

    private static boolean runActive(Connection c, RunContext ctx) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT 1 FROM runs WHERE environment_id = ? AND run_id = ? AND status = 'active'")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private static long currentRevision(Connection c, RunContext ctx) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT revision FROM runs WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    private static long bumpRevision(Connection c, RunContext ctx) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("UPDATE runs SET revision = revision + 1 "
                + "WHERE environment_id = ? AND run_id = ? AND status = 'active' RETURNING revision")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new TxConflict("stale-run", "The run is retired or does not exist");
                return rs.getLong(1);
            }
        }
    }

    private static void insertReceipt(Connection c, RunContext ctx, Command cmd, String digest, JsonNode result,
            long revision) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO command_receipts (environment_id, run_id, "
                + "actor_id, command_id, command_type, input_digest, result, run_revision) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
            Object[] params = {ctx.environmentId(), ctx.runId(), ctx.actorId(), cmd.commandId(), cmd.type(), digest,
                result, revision};
            Tx.bind(ps, params);
            ps.executeUpdate();
        }
    }

    private static void insertEvent(Connection c, RunContext ctx, Command cmd, Tx.Event e, long revision)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO outbox_events (environment_id, run_id, event_id, "
                + "actor_id, command_id, event_type, payload, run_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) {
            Object[] params = {ctx.environmentId(), ctx.runId(), e.eventId(), ctx.actorId(), cmd.commandId(),
                e.eventType(), e.payload(), revision};
            Tx.bind(ps, params);
            ps.executeUpdate();
        }
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
