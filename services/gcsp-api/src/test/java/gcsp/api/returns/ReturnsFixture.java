package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh, uniquely named migrated schema with the claimed environment and active run-1; dropped by close(). */
final class ReturnsFixture implements AutoCloseable {

    static final String ENV = "test-env";
    static final Instant T0 = Instant.parse("2026-11-05T09:00:00Z");
    static final String POLICY_VERSION = "test-policy-v1";
    private static final AtomicInteger SEQ = new AtomicInteger();

    final String url;
    final String schema;

    private ReturnsFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static ReturnsFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_r_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ReturnsFixture f = new ReturnsFixture(url, schema);
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

    RunContext ctx() {
        return new RunContext(ENV, "run-1", "caller");
    }

    /** The retained-format policy copied from seed-v1.json, version test-policy-v1, outcome scenario off. */
    static ObjectNode policyDoc() throws IOException {
        try (InputStream in = ReturnsFixture.class.getResourceAsStream("/returns/policy.json")) {
            return (ObjectNode) ReturnJson.JSON.readTree(in);
        }
    }

    /** The policy variant with the outcome scenario on, choosing returned or missed. */
    static ObjectNode policyDocWithOutcome(String outcome) throws IOException {
        ObjectNode doc = policyDoc();
        ObjectNode value = (ObjectNode) row(doc, RetainedReturnPolicy.OUTCOME).get("value");
        value.put("enabled", true).put("outcome", outcome);
        return doc;
    }

    static ObjectNode row(JsonNode doc, String key) {
        for (JsonNode r : doc.get("assumptions")) if (key.equals(r.get("key").asText())) return (ObjectNode) r;
        throw new IllegalStateException(key);
    }

    static RetainedReturnPolicy policyFile(Path dir, Consumer<ObjectNode> edit) throws IOException {
        ObjectNode doc = policyDoc();
        edit.accept(doc);
        Path file = Files.createTempFile(dir, "policy", ".json");
        Files.writeString(file, doc.toString());
        return new RetainedReturnPolicy(file);
    }

    static ReturnProviderPort.Operation op(String step, String operationId, String orderUuid, AppointmentSlot slot,
            ObjectNode payload) {
        return new ReturnProviderPort.Operation(ENV, "run-1", operationId, orderUuid, step, slot, payload,
                Canonical.digest(payload));
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
