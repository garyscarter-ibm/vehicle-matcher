package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run, the case service over it, and settable port fixtures. */
final class CaseFixture implements AutoCloseable {

    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String POLICY = "gcsp-policy-v1";
    static final Instant NOW = Instant.parse("2026-11-05T09:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    final String url;
    final String schema;
    final EmployeeScope paula = new EmployeeScope(ENV, RUN, "emp-paula", "principal-paula", POLICY);
    final EmployeeScope alex = new EmployeeScope(ENV, RUN, "emp-alex", "principal-alex", POLICY);
    final GregScope greg = new GregScope(ENV, RUN, "principal-greg", POLICY);
    final Policy policy = new Policy();
    final Account account = new Account();
    final CaseCarSuitabilityPort suitability = new CaseDefaults.NoSuitability();
    CaseService service;
    private int ids;

    private CaseFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static CaseFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_c_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        CaseFixture f = new CaseFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        f.account.set("emp-paula", "Paula", "renewal:emp-paula", "2026-12-01");
        f.account.set("emp-alex", "Alex", "renewal:emp-alex", "2026-12-15");
        f.service = f.newService(f.pool());
        return f;
    }

    CaseService newService(PGSimpleDataSource pool) {
        return new CaseService(pool, policy, account, new OutboxCaseNotifications(), suitability,
                Clock.fixed(NOW, ZoneOffset.UTC));
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

    String nextId() {
        return "cmd-" + (++ids);
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

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Row counts, versions and revision that a refused or read-only operation must leave exactly as they were. */
    List<Long> snapshot() throws SQLException {
        List<Long> out = new ArrayList<>();
        for (String t : List.of("renewal_cases", "renewal_case_history", "command_receipts", "outbox_events")) {
            out.add(count("SELECT count(*) FROM " + t));
        }
        out.add(count("SELECT revision FROM runs WHERE run_id = ?", RUN));
        out.add(count("SELECT coalesce(sum(version), 0) FROM renewal_cases"));
        return out;
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    /** Reads the retained Node policy seed (never a copy), optionally editing a row's value before use. */
    static final class Policy implements CasePolicyPort {
        private final Map<String, Consumer<ObjectNode>> edits = new LinkedHashMap<>();
        volatile boolean missing;

        void edit(String key, Consumer<ObjectNode> change) {
            edits.put(key, change);
        }

        void set(String key, JsonNode value) {
            edits.put(key, row -> row.set("value", value));
        }

        @Override
        public Optional<Map<String, JsonNode>> assumptions(String policyVersion) {
            if (missing) return Optional.empty();
            try {
                JsonNode seed = CaseJson.M.readTree(Files.readString(SEED));
                Map<String, JsonNode> rows = new LinkedHashMap<>();
                for (JsonNode a : seed.get("assumptions")) {
                    String key = a.get("key").asText();
                    if (!CasePolicy.KEYS.contains(key) || !policyVersion.equals(a.get("policyVersion").asText())) continue;
                    ObjectNode copy = a.deepCopy();
                    if (edits.containsKey(key)) edits.get(key).accept(copy);
                    rows.put(key, copy);
                }
                return rows.isEmpty() ? Optional.empty() : Optional.of(rows);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    static final class Account implements CaseAccountPort {
        private final Map<String, Lookup> byEmployee = new java.util.concurrent.ConcurrentHashMap<>();
        volatile boolean unavailable;

        void set(String employeeId, String name, String renewalId, String end) {
            byEmployee.put(employeeId, Lookup.ok(name, renewalId, end));
        }

        @Override
        public Lookup renewal(String environmentId, String runId, String employeeId) {
            if (unavailable) return Lookup.unavailable();
            return byEmployee.getOrDefault(employeeId, Lookup.ok(null, null, null));
        }
    }
}
