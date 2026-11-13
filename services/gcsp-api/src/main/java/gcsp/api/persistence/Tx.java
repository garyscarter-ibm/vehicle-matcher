package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.postgresql.util.PGobject;

/** The open command transaction handed to a work callback: the connection plus change-tracking helpers. */
public final class Tx {

    /** Maps the current row of a result set. */
    @FunctionalInterface
    public interface RowMapper<T> {
        T map(ResultSet rs) throws SQLException;
    }

    record Event(String eventId, String eventType, JsonNode payload) {}

    private final Connection connection;
    private final RunContext context;
    private final String commandId;
    private final List<Event> events = new ArrayList<>();
    private boolean changed;

    Tx(Connection connection, RunContext context, String commandId) {
        this.connection = connection;
        this.context = context;
        this.commandId = commandId;
    }

    public Connection connection() {
        return connection;
    }

    public RunContext context() {
        return context;
    }

    public String commandId() {
        return commandId;
    }

    /** Runs an INSERT/UPDATE; the command counts as changed when any row was touched. */
    public int write(String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            bind(ps, params);
            int rows = ps.executeUpdate();
            if (rows > 0) changed = true;
            return rows;
        }
    }

    /** A version-checked UPDATE ({@code ... WHERE key AND version = ?}); no row matched is stale-version. */
    public void cas(String sql, Object... params) throws SQLException {
        if (write(sql, params) == 0) {
            throw new TxConflict("stale-version", "The record changed since it was read");
        }
    }

    /** First row of a selected read, if any. */
    public <T> Optional<T> first(String sql, RowMapper<T> mapper, Object... params) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.ofNullable(mapper.map(rs)) : Optional.empty();
            }
        }
    }

    /** Queues an outbox row, written with the receipt at the new run revision only if the command changed data. */
    public void emit(String eventId, String eventType, JsonNode payload) {
        events.add(new Event(eventId, eventType, payload));
    }

    boolean changed() {
        return changed;
    }

    List<Event> events() {
        return events;
    }

    static void bind(PreparedStatement ps, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object p = params[i];
            if (p instanceof JsonNode json) {
                PGobject o = new PGobject();
                o.setType("jsonb");
                o.setValue(json.toString());
                ps.setObject(i + 1, o);
            } else if (p instanceof Instant instant) {
                ps.setObject(i + 1, instant.atOffset(ZoneOffset.UTC));
            } else {
                ps.setObject(i + 1, p);
            }
        }
    }
}
