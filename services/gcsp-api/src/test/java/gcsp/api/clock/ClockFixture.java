package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.PolicySourceException;
import gcsp.api.policy.RetainedFilePolicySource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh, uniquely named migrated schema with the claimed environment and active run-1; dropped by close(). */
final class ClockFixture implements AutoCloseable {

    static final String ENV = "test-env";
    /** A London date after the policy's effective date, so the run's clock starts on 14 November. */
    static final Instant WALL = Instant.parse("2026-11-14T10:00:00Z");
    static final Instant START = Instant.parse("2026-11-14T09:00:00Z");
    private static final AtomicInteger SEQ = new AtomicInteger();

    final String url;
    final String schema;

    private ClockFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    static ClockFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_c_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ClockFixture f = new ClockFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return f;
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** A new connection source bound to this schema; each call is an independent "pool". */
    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    RunContext ctx() {
        return new RunContext(ENV, "run-1", "presenter:test");
    }

    RunClock clock(List<TickHandler> handlers) throws SQLException {
        return clock(new PolicyService(new RetainedFilePolicySource()), handlers);
    }

    RunClock clock(PolicyService policy, List<TickHandler> handlers) throws SQLException {
        PGSimpleDataSource pool = pool();
        return new RunClock(pool, new TransactionRunner(pool), policy, handlers, InstantSource.fixed(WALL));
    }

    /** A clock that has been initialized for run-1. */
    RunClock started(TickHandler... handlers) throws SQLException {
        RunClock clock = clock(List.of(handlers));
        ClockResult initialized = clock.initialize(ENV, "run-1");
        if (!initialized.ok()) throw new IllegalStateException("initialize failed: " + initialized);
        return clock;
    }

    /** The retained policy with one assumption key removed. */
    static PolicyService policyWithout(String key) throws PolicySourceException {
        return new PolicyService(editing(doc -> {
            ArrayNode kept = doc.arrayNode();
            doc.withArray("assumptions").forEach(row -> {
                if (!key.equals(row.path("key").asText())) kept.add(row);
            });
            doc.set("assumptions", kept);
        }));
    }

    /** The retained policy, edited in a copy of each version. */
    static PolicySource editing(java.util.function.Consumer<ObjectNode> edit) throws PolicySourceException {
        List<JsonNode> base = new RetainedFilePolicySource().loadVersions("run-1");
        List<JsonNode> copies = new ArrayList<>();
        for (JsonNode doc : base) {
            ObjectNode copy = doc.deepCopy();
            edit.accept(copy);
            copies.add(copy);
        }
        return runId -> copies;
    }

    /** A source whose answers come from successive documents: the nth load returns pick.apply(n). */
    static PolicySource sequence(Function<Integer, PolicySource> pick) {
        AtomicInteger calls = new AtomicInteger();
        return runId -> pick.apply(calls.getAndIncrement()).loadVersions(runId);
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
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
