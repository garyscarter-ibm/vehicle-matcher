package gcsp.api.offers;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A migrated throwaway schema with environment, runs and plain-SQL seeding of the offer FK chain. */
final class OffersPg implements AutoCloseable {

    static final String ENV = "test-env";
    private static final AtomicInteger RUNS = new AtomicInteger();
    private static final AtomicInteger IDS = new AtomicInteger();

    final String url;
    final String schema;

    private OffersPg(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset; a set but unreachable URL fails. */
    static OffersPg create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_o_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(RUNS.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        OffersPg pg = new OffersPg(url, schema);
        pg.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        pg.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return pg;
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** A fresh pool over the same schema, as a restarted service would open. */
    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    /** Retires the active run and activates the next one. */
    void rollRun(String from, String to) throws SQLException {
        update("UPDATE runs SET status = 'retired', retired_at = now() WHERE environment_id = ? AND run_id = ?", ENV, from);
        update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, to);
    }

    static String hex() {
        return String.format("%064x", IDS.incrementAndGet());
    }

    /** One offer with its car, slot, allocation, quote and hold; returns the offer id. */
    String seed(String runId, String employeeId, String offerState, String holdState, Instant expiresAt,
            Instant createdAt) throws SQLException {
        String h = hex();
        String offerId = "buddy-offer:" + h;
        String order = "order-" + h.substring(60);
        String slot = "slot-" + h.substring(60);
        String alloc = "alloc-" + h.substring(60);
        String quote = "buddy-quote:" + h;
        String hold = "buddy-hold:" + h;
        OffsetDateTime exp = at(expiresAt);
        OffsetDateTime created = at(createdAt);
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                ENV, runId, employeeId);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, 1)", ENV, runId, slot, employeeId);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, ?, 'config-1', 'held')", ENV, runId, order);
        update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, "
                + "input_digest, state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, ?, 'stock-released', ?, ?, 'pending', now(), 1, 'policy-1', '{}'::jsonb, 0)",
                ENV, runId, alloc, "event-" + h, h);
        update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, "
                + "slot_id, configuration_id, policy_version, quoted_at, valid_until, monthly_points, vehicle_name, "
                + "image_path, quote) VALUES (?, ?, ?, ?, ?, ?, ?, 'config-1', 'policy-1', ?, ?, 420, 'BMW 120d', "
                + "'/img/a.jpg', '{\"gateStatus\":\"eligible\"}'::jsonb)",
                ENV, runId, quote, alloc, order, employeeId, slot, created, exp);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, "
                + "slot_unit, hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'buddy-offer', ?, ?)",
                ENV, runId, hold, order, employeeId, slot, holdState, exp);
        update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, "
                + "order_uuid, state, brief_version, policy_version, expires_at, created_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3, 'policy-1', ?, ?)",
                ENV, runId, offerId, hold, quote, employeeId, order, offerState, exp, created);
        return offerId;
    }

    private static OffsetDateTime at(Instant i) {
        return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
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
