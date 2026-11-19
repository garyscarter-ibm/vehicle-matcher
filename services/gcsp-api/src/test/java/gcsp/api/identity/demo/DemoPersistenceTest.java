package gcsp.api.identity.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The persisted signing key and the session store, on a fresh migrated schema of the native test database. */
class DemoPersistenceTest {

    private static final AtomicInteger RUNS = new AtomicInteger();
    private static final Duration REFRESH_LIFETIME = Duration.ofHours(12);

    private String url;
    private String schema;

    @BeforeEach
    void migrate() {
        url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        schema = "gcsp_t_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(RUNS.incrementAndGet());
        Flyway.configure().dataSource(plain()).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
    }

    @AfterEach
    void drop() throws SQLException {
        if (schema == null) return;
        try (Connection c = plain().getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private PGSimpleDataSource plain() {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** Each call is an independent "instance" with its own connections, bound to the test schema. */
    private PGSimpleDataSource instance() {
        PGSimpleDataSource ds = plain();
        ds.setCurrentSchema(schema);
        return ds;
    }

    private long count(String sql) throws SQLException {
        try (Connection c = instance().getConnection(); PreparedStatement ps = c.prepareStatement(sql);
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private static DemoSessions sessions(PGSimpleDataSource source, Instant at) {
        return new DemoSessions(source, Clock.fixed(at, ZoneOffset.UTC), REFRESH_LIFETIME);
    }

    @Test
    void theSigningKeyIsKeptAcrossARestart() {
        DemoSigningKeys first = DemoSigningKeys.load(instance());
        DemoSigningKeys afterRestart = DemoSigningKeys.load(instance());
        assertEquals(first.kid(), afterRestart.kid());
        assertEquals(first.jwksJson(), afterRestart.jwksJson());
        assertEquals(first.privateKey(), afterRestart.privateKey());
        assertTrue(first.jwksJson().contains("\"use\":\"sig\"") && first.jwksJson().contains("\"alg\":\"RS256\""),
                first.jwksJson());
        assertFalse(first.jwksJson().contains("\"d\""), "the JWKS must carry no private part");
    }

    @Test
    void twoInstancesStartingTogetherEndWithOneKey() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<String> load = () -> DemoSigningKeys.load(instance()).kid();
            Future<String> a = pool.submit(load);
            Future<String> b = pool.submit(load);
            assertEquals(a.get(), b.get());
            assertEquals(1, count("SELECT count(*) FROM demo_idp_signing_keys"));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void aRefreshTokenWorksOnceAndRotates() throws Exception {
        Instant now = Instant.now();
        DemoSessions sessions = sessions(instance(), now);
        DemoSessions.Session session = sessions.start("demo-paula");
        assertTrue(sessions.active(session.id()).isPresent());

        String first = sessions.issueRefreshToken(session.id());
        assertEquals(0, count("SELECT count(*) FROM demo_idp_refresh_tokens WHERE token_hash = '" + first + "'"),
                "only a hash is stored");

        DemoSessions.Renewal renewed = sessions.redeem(first).orElseThrow();
        assertEquals(session.id(), renewed.session().id());
        assertEquals("demo-paula", renewed.session().subject());
        assertNotEquals(first, renewed.refreshToken());

        assertTrue(sessions.redeem(first).isEmpty(), "a spent token is refused");
        assertTrue(sessions.redeem(renewed.refreshToken()).isPresent(), "the replacement works");
    }

    @Test
    void unknownAndExpiredRefreshTokensAreRefused() {
        Instant now = Instant.now();
        DemoSessions sessions = sessions(instance(), now);
        assertTrue(sessions.redeem("not-a-token").isEmpty());

        String token = sessions.issueRefreshToken(sessions.start("demo-paula").id());
        DemoSessions later = sessions(instance(), now.plus(REFRESH_LIFETIME).plusSeconds(1));
        assertTrue(later.redeem(token).isEmpty(), "an expired token is refused");
    }

    @Test
    void endingASessionRefusesItsRefreshTokens() {
        DemoSessions sessions = sessions(instance(), Instant.now());
        DemoSessions.Session paula = sessions.start("demo-paula");
        DemoSessions.Session greg = sessions.start("demo-greg");
        String paulaToken = sessions.issueRefreshToken(paula.id());
        String gregToken = sessions.issueRefreshToken(greg.id());

        assertTrue(sessions.end(paula.id()));
        assertFalse(sessions.end(paula.id()), "ending twice is a no-op");
        assertTrue(sessions.active(paula.id()).isEmpty());
        assertTrue(sessions.redeem(paulaToken).isEmpty());

        assertTrue(sessions.active(greg.id()).isPresent(), "another person's session is untouched");
        assertTrue(sessions.redeem(gregToken).isPresent());
    }

    @Test
    void aRefreshTokenIsRefusedOnceItsSessionHasEnded() {
        DemoSessions sessions = sessions(instance(), Instant.now());
        DemoSessions.Session session = sessions.start("demo-paula");
        String token = sessions.issueRefreshToken(session.id());
        String rotated = sessions.redeem(token).orElseThrow().refreshToken();
        sessions.end(session.id());
        assertTrue(sessions.redeem(rotated).isEmpty());
        assertEquals(Optional.empty(), sessions.active(session.id()));
    }
}
