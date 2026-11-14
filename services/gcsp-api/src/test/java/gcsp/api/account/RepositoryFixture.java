package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema on the native test cluster plus seeding of a Node golden's facts; dropped by close(). */
final class RepositoryFixture implements AutoCloseable {

    private static final AtomicInteger COUNT = new AtomicInteger();
    private static final List<String> TYPED_SLOT_KEYS =
            List.of("employeeId", "entitlementSlotId", "capacity", "runId", "version", "createdAt", "updatedAt");

    final String url;
    final String schema;

    private RepositoryFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset; a set but unreachable URL fails. */
    static RepositoryFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_a_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(COUNT.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        return new RepositoryFixture(url, schema);
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

    RepositoryAccountRecords records() throws SQLException {
        return new RepositoryAccountRecords(pool());
    }

    /** Environment identity and the golden's run, as EnvironmentGuard would leave them. */
    void claim(GoldenFixture fx) throws SQLException {
        try (Connection c = pool().getConnection()) {
            claim(c, fx.scope.environmentId(), fx.scope.runId());
        }
    }

    static void claim(Connection c, String env, String run) throws SQLException {
        update(c, "INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", env);
        update(c, "INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", env, run);
    }

    void seed(GoldenFixture fx) throws SQLException {
        try (Connection c = pool().getConnection()) {
            seed(c, fx, fx.scope.environmentId(), fx.scope.runId());
        }
    }

    /** Employee membership, the record aggregate (when the golden has one) and the golden's slots. */
    static void seed(Connection c, GoldenFixture fx, String env, String run) throws SQLException {
        String employee = fx.scope.employeeId();
        ObjectNode membership = GoldenFixture.JSON.createObjectNode().put("name", fx.scope.name())
                .put("companyId", fx.scope.companyId()).put("schemeId", fx.scope.schemeId())
                .put("gradeId", fx.scope.gradeId()).put("entitlementSlotId", fx.scope.entitlementSlotId());
        update(c, "INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, ?, ?::jsonb)",
                env, run, employee, membership.toString());
        JsonNode record = fx.input.get("manualContext");
        if (record != null && !record.isNull()) {
            update(c, "INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                    + "VALUES (?, ?, ?, ?, ?::jsonb, ?)", env, run, employee, record.get("recordSetId").asText(),
                    record.toString(), fx.input.get("employeeVersion").asLong());
        }
        for (JsonNode slot : fx.input.get("slots")) {
            ObjectNode attributes = GoldenFixture.JSON.createObjectNode();
            slot.fields().forEachRemaining(e -> {
                if (!TYPED_SLOT_KEYS.contains(e.getKey())) attributes.set(e.getKey(), e.getValue());
            });
            update(c, "INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, "
                    + "version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?::timestamptz, ?::timestamptz)",
                    env, run, slot.get("entitlementSlotId").asText(), employee, slot.get("capacity").asInt(),
                    attributes.toString(), slot.get("version").asLong(), slot.get("createdAt").asText(),
                    slot.get("updatedAt").asText());
        }
    }

    /** Removes what seed() added for one employee, children first. */
    static void remove(Connection c, String env, String run, String employee) throws SQLException {
        for (String table : List.of("employee_account_records", "entitlement_slots", "employees")) {
            update(c, "DELETE FROM " + table + " WHERE environment_id = ? AND run_id = ? AND employee_id = ?", env, run, employee);
        }
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection()) {
            update(c, sql, params);
        }
    }

    static void update(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
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
