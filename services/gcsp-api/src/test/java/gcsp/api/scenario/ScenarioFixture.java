package gcsp.api.scenario;

import gcsp.api.clock.RunClock;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.RunReset;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema on a native test database, claimed with active run-1; each call builds a new "process". */
final class ScenarioFixture implements AutoCloseable {

    static final String ENV = "scenario-env";
    static final Instant WALL = Instant.parse("2026-11-14T10:00:00Z");
    private static final AtomicInteger SEQ = new AtomicInteger();

    final String url;
    final String schema;
    final String database;
    final DemoPreparationFile file = DemoPreparationFile.load();

    private ScenarioFixture(String url, String schema, String database) {
        this.url = url;
        this.schema = schema;
        this.database = database;
    }

    /** Skips only when the named variable is unset. */
    static ScenarioFixture create(String urlVariable, boolean resetAllowed) throws SQLException {
        String url = System.getenv(urlVariable);
        Assumptions.assumeTrue(url != null && !url.isBlank(), urlVariable + " is not set");
        String schema = "gcsp_n_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        PGSimpleDataSource admin = plain(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        String database;
        try (Connection c = admin.getConnection(); ResultSet rs = c.createStatement().executeQuery("SELECT current_database()")) {
            rs.next();
            database = rs.getString(1);
        }
        ScenarioFixture f = new ScenarioFixture(url, schema, database);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, ?)", ENV, resetAllowed);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return f;
    }

    static ScenarioFixture create() throws SQLException {
        return create("GCSP_TEST_DATABASE_URL", true);
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    RunContext presenter(String runId) {
        return new RunContext(ENV, runId, "presenter:test");
    }

    /** A service over a new pool, as after a restart. */
    ScenarioService service() throws SQLException {
        return service(database);
    }

    ScenarioService service(String expectedDatabase) throws SQLException {
        PGSimpleDataSource pool = pool();
        TransactionRunner runner = new TransactionRunner(pool);
        RunClock clock = new RunClock(pool, runner, new PolicyService(new RetainedFilePolicySource()), List.of(),
                InstantSource.fixed(WALL));
        return new ScenarioService(pool, new RunReset(pool, expectedDatabase, ENV), clock,
                new DemoPreparation(pool, runner, clock, new PolicyService(new RetainedFilePolicySource()),
                        InstantSource.fixed(WALL), file), file);
    }

    RunClock clock() throws SQLException {
        PGSimpleDataSource pool = pool();
        return new RunClock(pool, new TransactionRunner(pool), new PolicyService(new RetainedFilePolicySource()), List.of(),
                InstantSource.fixed(WALL));
    }

    RunReset rawReset() throws SQLException {
        return new RunReset(pool(), database, ENV);
    }

    long count(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String text(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
