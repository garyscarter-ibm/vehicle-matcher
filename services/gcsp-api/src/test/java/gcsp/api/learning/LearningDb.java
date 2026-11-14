package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefAccountPort;
import gcsp.api.brief.BriefAssumptions;
import gcsp.api.brief.BriefOfferPort;
import gcsp.api.brief.BriefPolicyPort;
import gcsp.api.brief.BriefScope;
import gcsp.api.brief.BriefService;
import gcsp.api.identity.Principal;
import gcsp.api.policy.PolicyService;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with one active run, a counting DataSource and the policy/principal builders the tests share. */
final class LearningDb implements AutoCloseable {

    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String POLICY = "gcsp-policy-v1";
    static final String NOW = "2026-11-13T12:00:00.000Z";
    static final Instant BRIEF_NOW = Instant.parse("2026-11-13T10:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();

    final String url;
    final String schema;
    final AtomicInteger statements = new AtomicInteger();

    private LearningDb(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static LearningDb create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_l_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        LearningDb db = new LearningDb(url, schema);
        db.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        db.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        return db;
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

    /** The pool wrapped so each statement a connection prepares or creates is counted. */
    DataSource counting() throws SQLException {
        PGSimpleDataSource pool = pool();
        return (DataSource) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {DataSource.class}, (p, m, args) -> {
            Object out = invoke(m, pool, args);
            if (!m.getName().equals("getConnection")) return out;
            Connection real = (Connection) out;
            return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Connection.class}, (cp, cm, cargs) -> {
                if (cm.getName().equals("prepareStatement") || cm.getName().equals("createStatement")) statements.incrementAndGet();
                return invoke(cm, real, cargs);
            });
        });
    }

    private static Object invoke(java.lang.reflect.Method m, Object target, Object[] args) throws Throwable {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    static LearningRecordService service(DataSource source, PolicyService policy, LearningOutcomeRows outcomes) {
        return service(source, policy, new LearningClock.Reading(NOW, "clock-v1"), outcomes);
    }

    static LearningRecordService service(DataSource source, PolicyService policy, LearningClock.Reading reading,
            LearningOutcomeRows outcomes) {
        return new LearningRecordService(() -> source, policy, context -> reading, outcomes);
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

    /** Run revision and the row counts a read must leave untouched. */
    List<Long> snapshot() throws SQLException {
        return List.of(count("SELECT revision FROM runs WHERE run_id = ?", RUN), count("SELECT count(*) FROM briefs"),
                count("SELECT count(*) FROM brief_heads"), count("SELECT count(*) FROM employees"),
                count("SELECT count(*) FROM entitlement_slots"), count("SELECT count(*) FROM stock_cars"),
                count("SELECT count(*) FROM command_receipts"), count("SELECT count(*) FROM outbox_events"));
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    // ---- principals and policy ----

    static Principal greg() {
        return new Principal("greg-1", List.of("greg"), ENV, RUN, null, POLICY, List.of());
    }

    static Principal employee() {
        return new Principal("emp-sub", List.of("employee"), ENV, RUN, "emp-1", POLICY, List.of());
    }

    /** The seed with the reviewed decline-reason registry published as an assumption row; null omits it. */
    static PolicyService policy(JsonNode declineReasons) {
        ObjectNode seed = LearningFixtures.seed();
        if (declineReasons != null) {
            ObjectNode row = LearningFixtures.referenceRow(declineReasons.deepCopy());
            row.put("key", LearningRecordService.DECLINE_REASONS_KEY);
            row.put("unit", "reason-registry");
            ((ArrayNode) seed.get("assumptions")).add(row);
        }
        List<JsonNode> versions = List.of(seed);
        return new PolicyService(runId -> versions);
    }

    static ObjectNode reviewedReasons() {
        JsonNode set = LearningFixtures.read(java.nio.file.Path.of("../../server/gcsp/policy/reviewed/offer-decline-reasons-v1.json"));
        return (ObjectNode) set.get("definitions").get(0).get("value").deepCopy();
    }

    // ---- the real brief producer ----

    /** A BriefService over this schema with the retained seed as its policy; accounts and offers are empty. */
    BriefService briefService() throws SQLException {
        BriefPolicyPort policy = version -> {
            Map<String, JsonNode> entries = new LinkedHashMap<>();
            for (JsonNode a : LearningFixtures.seed().get("assumptions")) {
                String key = a.get("key").asText();
                if (BriefAssumptions.KEYS.contains(key) && version.equals(a.get("policyVersion").asText())) entries.put(key, a);
            }
            return entries.isEmpty() ? Optional.empty() : Optional.of(new BriefAssumptions(version, entries));
        };
        BriefAccountPort account = (env, run, employee) -> Optional.empty();
        BriefOfferPort offers = (env, run, employee) -> List.of();
        return new BriefService(pool(), policy, account, offers, Clock.fixed(BRIEF_NOW, ZoneOffset.UTC));
    }

    static BriefScope scope(String employeeId) {
        return new BriefScope(ENV, RUN, employeeId, "principal-" + employeeId, POLICY);
    }

    // ---- direct inserts ----

    private static final String CONTENT = "{\"schemaVersion\":1,\"preferences\":{\"body\":{\"value\":\"estate\",\"importance\":70,"
            + "\"valueState\":\"confirmed\",\"importanceState\":\"confirmed\"}},\"essentials\":{\"seats\":{\"value\":5,"
            + "\"operator\":\"gte\",\"unit\":\"count\",\"state\":\"confirmed\"}}}";

    /** One confirmed version 1 brief per employee, written straight to the table. */
    void insertBriefs(int employees, String confirmedAt) throws SQLException {
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) SELECT ?, ?, 'e' || lpad(g::text, 5, '0'), 1 "
                + "FROM generate_series(1, ?) g", ENV, RUN, employees);
        update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, operation, content, buddy, semantic_digest, "
                + "policy_version, confirmed_by, confirmed_at, command_id) SELECT ?, ?, 'e' || lpad(g::text, 5, '0'), 1, 'confirmed', "
                + "?::jsonb, '{}'::jsonb, repeat('a', 64), ?, 'p', ?::timestamptz, 'c' || g FROM generate_series(1, ?) g",
                ENV, RUN, CONTENT, POLICY, confirmedAt, employees);
    }
}
