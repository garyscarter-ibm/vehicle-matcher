package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Tx.RowMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.postgresql.util.PGobject;

/** Plain selected reads on one connection (a command's own, or a pooled one for reads). */
final class Db {

    private Db() {}

    static <T> Optional<T> first(Connection c, String sql, RowMapper<T> mapper, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.ofNullable(mapper.map(rs)) : Optional.empty();
            }
        }
    }

    static <T> List<T> list(Connection c, String sql, RowMapper<T> mapper, Object... params) throws SQLException {
        List<T> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(mapper.map(rs));
            }
        }
        return out;
    }

    static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    private static void bind(PreparedStatement ps, Object[] params) throws SQLException {
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
