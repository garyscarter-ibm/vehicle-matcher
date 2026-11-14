package gcsp.api.evidence;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh schema migrated on the native test cluster with a claimed environment and an active run-1; dropped by close(). */
final class EvidencePgFixture implements AutoCloseable {

    static final String ENV = "stock-env";
    private static final AtomicInteger COUNT = new AtomicInteger();

    final String url;
    final String schema;

    private EvidencePgFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset; a set but unreachable URL fails. */
    static EvidencePgFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_ev_" + Long.toHexString(System.nanoTime()) + "_" + COUNT.incrementAndGet();
        PGSimpleDataSource admin = plain(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        EvidencePgFixture f = new EvidencePgFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return f;
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

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Inserts a stock car whose attributes are the given JSON text, in the given run. */
    void car(String runId, String orderUuid, String configurationId, String state, String attributesJson) throws SQLException {
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, ?, ?, ?::jsonb)", ENV, runId, orderUuid, configurationId, state, attributesJson);
    }

    /** A retired run-0, which carries cars the active run must never read. */
    void retiredRun(String runId) throws SQLException {
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())", ENV, runId);
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
