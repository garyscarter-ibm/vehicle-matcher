package gcsp.api.identity.demo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import javax.sql.DataSource;

/** Demo sign-in sessions and single-use, rotating refresh tokens. Only a token's SHA-256 hash is ever stored. */
public final class DemoSessions {

    /** A live sign-in session. */
    public record Session(String id, String subject, Instant authTime) {}

    /** A redeemed refresh token: its session and the replacement token (the old one is now spent). */
    public record Renewal(Session session, String refreshToken) {}

    private static final SecureRandom RANDOM = new SecureRandom();

    private final DataSource source;
    private final Clock clock;
    private final Duration refreshLifetime;

    public DemoSessions(DataSource source, Clock clock, Duration refreshLifetime) {
        this.source = source;
        this.clock = clock;
        this.refreshLifetime = refreshLifetime;
    }

    /** Starts a session for a subject, signed in now. */
    public Session start(String subject) {
        Session s = new Session(randomHex(16), subject, clock.instant());
        run(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO demo_idp_sessions (session_id, subject, auth_time) VALUES (?, ?, ?)")) {
                ps.setString(1, s.id());
                ps.setString(2, s.subject());
                ps.setObject(3, at(s.authTime()));
                ps.executeUpdate();
            }
            return null;
        });
        return s;
    }

    /** The session when it exists and has not been ended. */
    public Optional<Session> active(String sessionId) {
        return run(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT session_id, subject, auth_time FROM demo_idp_sessions WHERE session_id = ? AND ended_at IS NULL")) {
                ps.setString(1, sessionId);
                try (ResultSet rs = ps.executeQuery()) {
                    return rs.next() ? Optional.of(session(rs)) : Optional.<Session>empty();
                }
            }
        });
    }

    /** Issues a refresh token for a session (random, 32 bytes) and returns it; it is shown once and stored hashed. */
    public String issueRefreshToken(String sessionId) {
        return run(c -> insertToken(c, sessionId));
    }

    /**
     * Spends a refresh token and issues its replacement, in one transaction. A reused, expired, unknown or
     * ended-session token gives empty.
     */
    public Optional<Renewal> redeem(String refreshToken) {
        return run(c -> {
            c.setAutoCommit(false);
            try {
                Optional<Renewal> out = redeemIn(c, refreshToken);
                c.commit();
                return out;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        });
    }

    /** Ends a session and spends its unused refresh tokens; true when it was live. */
    public boolean end(String sessionId) {
        return run(c -> {
            c.setAutoCommit(false);
            try {
                boolean ended;
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE demo_idp_sessions SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL")) {
                    ps.setObject(1, at(clock.instant()));
                    ps.setString(2, sessionId);
                    ended = ps.executeUpdate() == 1;
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE demo_idp_refresh_tokens SET used_at = ? WHERE session_id = ? AND used_at IS NULL")) {
                    ps.setObject(1, at(clock.instant()));
                    ps.setString(2, sessionId);
                    ps.executeUpdate();
                }
                c.commit();
                return ended;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        });
    }

    private Optional<Renewal> redeemIn(Connection c, String refreshToken) throws SQLException {
        Session session;
        try (PreparedStatement ps = c.prepareStatement("UPDATE demo_idp_refresh_tokens t SET used_at = ? FROM demo_idp_sessions s "
                + "WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? "
                + "AND s.session_id = t.session_id AND s.ended_at IS NULL "
                + "RETURNING s.session_id, s.subject, s.auth_time")) {
            OffsetDateTime now = at(clock.instant());
            ps.setObject(1, now);
            ps.setString(2, hash(refreshToken));
            ps.setObject(3, now);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                session = session(rs);
            }
        }
        return Optional.of(new Renewal(session, insertToken(c, session.id())));
    }

    private String insertToken(Connection c, String sessionId) throws SQLException {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO demo_idp_refresh_tokens (token_hash, session_id, expires_at) VALUES (?, ?, ?)")) {
            ps.setString(1, hash(token));
            ps.setString(2, sessionId);
            ps.setObject(3, at(clock.instant().plus(refreshLifetime)));
            ps.executeUpdate();
        }
        return token;
    }

    private static Session session(ResultSet rs) throws SQLException {
        return new Session(rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class).toInstant());
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private interface Sql<T> {
        T apply(Connection c) throws SQLException;
    }

    private <T> T run(Sql<T> work) {
        try (Connection c = source.getConnection()) {
            return work.apply(c);
        } catch (SQLException e) {
            throw new IllegalStateException("The demo sign-in session store failed (SQLState " + e.getSQLState() + ")");
        }
    }
}
