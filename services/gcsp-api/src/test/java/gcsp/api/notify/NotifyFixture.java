package gcsp.api.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A uniquely named schema migrated with every migration (V1 and V469_1), claimed with run-1 and employee emp-1. */
final class NotifyFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "notify-env";
    static final Instant T0 = Instant.parse("2026-11-14T10:00:00Z");
    private static final AtomicInteger RUNS = new AtomicInteger();

    /** A clock the test moves by hand. */
    static final class Clock implements InstantSource {
        volatile Instant now = T0;

        @Override
        public Instant instant() {
            return now;
        }

        void advance(long seconds) {
            now = now.plusSeconds(seconds);
        }
    }

    final String url;
    final String schema;

    private NotifyFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static NotifyFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_n_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(RUNS.incrementAndGet());
        PGSimpleDataSource admin = plain(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        NotifyFixture f = new NotifyFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        f.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) "
                + "VALUES (?, 'run-1', 'emp-1', '{\"name\":\"Alex Example\"}'::jsonb)", ENV);
        f.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, 'run-1', 'emp-2')", ENV);
        return f;
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** An independent connection source bound to this schema. */
    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    RunContext ctx() {
        return new RunContext(ENV, "run-1", "business-actor");
    }

    String database() throws SQLException {
        return text("SELECT current_database()");
    }

    /** A business command that inserts a domain row (a stock car) and emits the offer intent. */
    Outcome createOffer(String offerId, String employeeId) throws SQLException {
        return new TransactionRunner(pool()).execute(ctx(),
                new Command("offer.create", "create-" + offerId, JSON.createObjectNode().put("offerId", offerId)), tx -> {
                    tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                            + "VALUES (?, ?, ?, 'cfg', 'available')", ENV, "run-1", "car-" + offerId);
                    NotificationIntent.offer(tx, offerId, employeeId);
                    return WorkResult.ok(JSON.createObjectNode().put("offerId", offerId));
                });
    }

    String text(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    long count(String sql, Object... params) throws SQLException {
        return Long.parseLong(text(sql, params));
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    String delivery(String column, String eventId) throws SQLException {
        return text("SELECT " + column + "::text FROM notification_deliveries WHERE run_id = 'run-1' AND event_id = ?", eventId);
    }

    String outbox(String column, String eventId) throws SQLException {
        return text("SELECT " + column + "::text FROM outbox_events WHERE run_id = 'run-1' AND event_id = ?", eventId);
    }

    static ObjectNode obj() {
        return JSON.createObjectNode();
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
