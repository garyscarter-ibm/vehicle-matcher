package gcsp.api.allocation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.postgresql.util.PGobject;

/** Small JDBC helpers for explicit SQL: binding (JSON, instants, text arrays) and mapped reads. */
final class Sql {

    static final ObjectMapper JSON = new ObjectMapper();

    @FunctionalInterface
    interface Row<T> {
        T map(ResultSet rs) throws SQLException;
    }

    private Sql() {}

    static <T> List<T> query(Connection c, String sql, Row<T> row, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(c, ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                List<T> out = new ArrayList<>();
                while (rs.next()) out.add(row.map(rs));
                return out;
            }
        }
    }

    static <T> T one(Connection c, String sql, Row<T> row, Object... params) throws SQLException {
        List<T> rows = query(c, sql, row, params);
        return rows.isEmpty() ? null : rows.get(0);
    }

    static void bind(Connection c, PreparedStatement ps, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object p = params[i];
            if (p instanceof JsonNode json) {
                PGobject o = new PGobject();
                o.setType("jsonb");
                o.setValue(json.toString());
                ps.setObject(i + 1, o);
            } else if (p instanceof Instant instant) {
                ps.setObject(i + 1, instant.atOffset(ZoneOffset.UTC));
            } else if (p instanceof String[] texts) {
                ps.setArray(i + 1, c.createArrayOf("text", texts));
            } else {
                ps.setObject(i + 1, p);
            }
        }
    }

    static JsonNode json(String text) throws SQLException {
        if (text == null) return null;
        try {
            return JSON.readTree(text);
        } catch (JsonProcessingException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }

    static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }
}
