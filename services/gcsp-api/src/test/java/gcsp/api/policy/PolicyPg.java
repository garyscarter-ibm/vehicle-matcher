package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh, uniquely named, fully migrated schema on the native test cluster, with the policy classes wired over it. */
final class PolicyPg implements AutoCloseable {

    static final String ENV = "policy-env";
    static final String HOLD = "hold.cart.durationSeconds";
    static final Instant T0 = Instant.parse("2026-11-05T09:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();

    /** A settable clock; the same instant is returned until a test moves it. */
    static final class TestClock implements PolicyClock {
        volatile Instant now = T0;

        @Override
        public Instant now(RunContext context) {
            return now;
        }
    }

    final String url;
    final String schema;
    final TestClock clock = new TestClock();
    final RetainedFilePolicySource file = new RetainedFilePolicySource();
    final PolicyDatabase database;
    final PostgresPolicySource source;
    final PolicyService service;
    final PolicyActivation activation;
    final PolicyPublisher publisher;

    private PolicyPg(String url, String schema) throws SQLException {
        this(url, schema, null);
    }

    private PolicyPg(String url, String schema, javax.sql.DataSource wrapped) throws SQLException {
        this.url = url;
        this.schema = schema;
        this.database = new PolicyDatabase(wrapped != null ? wrapped : pool(), ENV);
        this.source = new PostgresPolicySource(database, file);
        this.service = new PolicyService(source);
        this.activation = new PolicyActivation(service, database, clock);
        this.publisher = new PolicyPublisher(source, file, database, clock, new PolicyAuthority(), activation);
        service.withPublisher(publisher);
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. Run-1 is the active run. */
    static PolicyPg create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_p_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        PolicyPg pg = new PolicyPg(url, schema);
        pg.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        pg.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return pg;
    }

    /** Another set of policy classes over the same schema with a datasource wrapper (a restart or a fault hook). */
    PolicyPg rewired(java.util.function.UnaryOperator<javax.sql.DataSource> wrap) throws SQLException {
        return new PolicyPg(url, schema, wrap.apply(pool()));
    }

    /** A new pool over the same schema: what a restarted process sees. */
    PolicyPg restarted() throws SQLException {
        return new PolicyPg(url, schema);
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

    static Principal greg(String runId) {
        return new Principal("greg-subject", List.of("greg"), ENV, runId, null, "gcsp-policy-v1", List.of());
    }

    static Principal employee(String runId) {
        return new Principal("employee-subject", List.of("employee"), ENV, runId, "e1", "gcsp-policy-v1", List.of());
    }

    static RunContext ctx(String runId) {
        return new RunContext(ENV, runId, "greg-subject");
    }

    void addRetiredRun(String runId) throws SQLException {
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())", ENV, runId);
    }

    /** Retires the run, activating another so the one-active rule holds. */
    void retire(String runId, String nextRunId) throws SQLException {
        update("UPDATE runs SET status = 'retired', retired_at = now() WHERE environment_id = ? AND run_id = ?", ENV, runId);
        update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, nextRunId);
    }

    static ObjectNode change(String commandId, String expected, String version, String effectiveFrom, JsonNode... changes) {
        ObjectNode input = Seeds.MAPPER.createObjectNode();
        input.put("commandId", commandId);
        input.put("expectedActiveVersion", expected);
        input.put("policyVersion", version);
        input.put("effectiveFrom", effectiveFrom);
        ArrayNode array = input.putArray("changes");
        for (JsonNode c : changes) {
            array.add(c);
        }
        return input;
    }

    static ObjectNode patch(String table, String key, Object... fields) {
        ObjectNode change = Seeds.MAPPER.createObjectNode();
        change.put("table", table);
        change.put("key", key);
        ObjectNode patch = change.putObject("patch");
        patch.put("basis", "Native test input.");
        patch.put("source", "PolicyPg");
        patch.put("sourceDate", "2026-11-05");
        patch.put("status", "assumed");
        for (int i = 0; i < fields.length; i += 2) {
            patch.set((String) fields[i], Seeds.MAPPER.valueToTree(fields[i + 1]));
        }
        return change;
    }

    static ObjectNode holdChange(String commandId, String expected, String version, String effectiveFrom, int seconds) {
        return change(commandId, expected, version, effectiveFrom, patch("assumptions", HOLD, "value", seconds));
    }

    /** The active-at-asOf or pinned value of the hold duration, or -1 when the read does not succeed. */
    int hold(String runId, String asOf, String pin) {
        PolicyResult r = service.getAssumption(HOLD, new PolicyRead(runId, asOf, pin));
        return r.ok() ? r.value().get("value").intValue() : -1;
    }

    long count(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    long revision(String runId) throws SQLException {
        return count("SELECT revision FROM runs WHERE environment_id = ? AND run_id = ?", ENV, runId);
    }

    String text(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            ps.executeUpdate();
        }
    }

    /** Row counts of every policy table and the receipt table, for before/after atomicity checks. */
    List<Long> policyRows() throws SQLException {
        return List.of(count("SELECT count(*) FROM policy_documents"), count("SELECT count(*) FROM policy_versions"),
                count("SELECT count(*) FROM policy_run_activation"), count("SELECT count(*) FROM command_receipts"),
                count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
