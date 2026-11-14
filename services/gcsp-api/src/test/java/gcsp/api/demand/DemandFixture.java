package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.DemandPolicyPort.DemandPolicy;
import gcsp.api.demand.OfferRecordsPort.DecisionRow;
import gcsp.api.demand.OfferRecordsPort.OfferRecords;
import gcsp.api.demand.OfferRecordsPort.OfferRow;
import gcsp.api.demand.UnmetEvaluationPort.BriefCandidate;
import gcsp.api.demand.UnmetEvaluationPort.CarDecision;
import gcsp.api.demand.UnmetEvaluationPort.Evaluation;
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
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema seeded with SQL rows, stub ports and a service over them; the schema is dropped on close. */
final class DemandFixture implements AutoCloseable {

    static final ObjectMapper M = new ObjectMapper();
    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String POLICY = "gcsp-policy-v1";
    static final String COMPANY = "co-1";
    static final String SCHEME = "sch-1";
    static final Instant NOW = Instant.parse("2026-11-13T10:00:00Z");
    static final DemandScope SCOPE = new DemandScope(ENV, RUN, POLICY);
    private static final AtomicInteger SERIAL = new AtomicInteger();
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    static final List<String> REASONS = List.of("body-style", "price", "timing");

    final String url;
    final String schema;
    final Policy policy = new Policy();
    final Evaluator evaluator = new Evaluator();
    final Offers offers = new Offers();
    DemandService service;

    private DemandFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static DemandFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_d_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        DemandFixture f = new DemandFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status, revision) VALUES (?, ?, 'active', 7)", ENV, RUN);
        f.service = f.service(f.policy, f.evaluator, f.offers);
        return f;
    }

    DemandService service(DemandPolicyPort p, UnmetEvaluationPort u, OfferRecordsPort o) throws SQLException {
        return new DemandService(pool(), p, u, o, Clock.fixed(NOW, ZoneOffset.UTC));
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

    private Connection seedConnection;
    private final Map<String, Integer> units = new java.util.HashMap<>();

    void update(String sql, Object... params) throws SQLException {
        if (seedConnection == null || seedConnection.isClosed()) seedConnection = pool().getConnection();
        try (PreparedStatement ps = seedConnection.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                Object p = params[i];
                if (p instanceof JsonNode n) ps.setObject(i + 1, n.toString(), java.sql.Types.OTHER);
                else ps.setObject(i + 1, p);
            }
            ps.executeUpdate();
        }
    }

    static ObjectNode json(String text) {
        try {
            return (ObjectNode) M.readTree(text);
        } catch (IOException e) {
            throw new IllegalArgumentException(e);
        }
    }

    // ---- seeding ----

    void employee(String id) throws SQLException {
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, ?, ?)", ENV, RUN, id,
                json("{\"companyId\":\"" + COMPANY + "\",\"schemeId\":\"" + SCHEME + "\",\"name\":\"PRIVATE-NAME-" + id + "\"}"));
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, ?, ?, 5)",
                ENV, RUN, "slot-" + id, id);
    }

    /** Appends confirmed brief version v and moves the head to it (a lower head leaves later rows as history). */
    void brief(String employee, int version, ObjectNode content) throws SQLException {
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", ENV, RUN, employee);
        update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, content, "
                + "buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                + "VALUES (?, ?, ?, ?, ?, 'confirmed', ?, '{}'::jsonb, ?, ?, 'p', now(), ?)", ENV, RUN, employee, version,
                version == 1 ? null : version - 1, content, "a".repeat(64), POLICY, "cmd-" + employee + "-" + version);
        update("UPDATE brief_heads SET brief_version = ? WHERE environment_id = ? AND run_id = ? AND employee_id = ?",
                version, ENV, RUN, employee);
    }

    /** A saved draft is not demand: only brief_heads.brief_version counts. */
    void draft(String employee, int version, ObjectNode content) throws SQLException {
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", ENV, RUN, employee);
        update("INSERT INTO brief_drafts (environment_id, run_id, employee_id, draft_version, base_brief_version, content, "
                + "semantic_digest, policy_version, saved_by, saved_at, command_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'p', now(), ?)",
                ENV, RUN, employee, version, content, "b".repeat(64), POLICY, "draft-" + employee + "-" + version);
    }

    static ObjectNode brief(Object body, Object fuel, Object seats, String modelLine) {
        ObjectNode c = json("{\"schemaVersion\":1,\"preferences\":{},\"essentials\":{}}");
        if (body != null) ((ObjectNode) c.get("preferences")).set("body", pref(body, 100));
        if (fuel != null) ((ObjectNode) c.get("preferences")).set("fuel", pref(fuel, 100));
        if (seats != null) ((ObjectNode) c.get("essentials")).set("seats",
                json("{\"value\":" + seats + ",\"operator\":\"gte\",\"unit\":\"count\",\"state\":\"confirmed\"}"));
        if (modelLine != null) ((ObjectNode) c.get("essentials")).set("modelLine",
                json("{\"value\":\"" + modelLine + "\",\"operator\":\"equals\",\"unit\":null,\"state\":\"confirmed\"}"));
        return c;
    }

    static ObjectNode pref(Object value, int importance) {
        ObjectNode p = json("{\"importance\":" + importance + ",\"valueState\":\"confirmed\",\"importanceState\":\"confirmed\"}");
        p.set("value", M.valueToTree(value));
        return p;
    }

    /** A released car visible to the default company and scheme, available until 2027. */
    void car(String uuid, String modelLine) throws SQLException {
        car(uuid, modelLine, "{\"companyIds\":[\"" + COMPANY + "\"],\"schemeIds\":[\"" + SCHEME + "\"],\"employeeIds\":null}");
    }

    void car(String uuid, String modelLine, String visibility) throws SQLException {
        String facts = modelLine == null ? "{}" : "{\"modelLine\":{\"status\":\"known\",\"value\":\"" + modelLine + "\"}}";
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, 'cfg', 'released', ?)", ENV, RUN, uuid, json("{\"facts\":{\"facts\":" + facts + "},"
                + "\"release\":{\"availability\":{\"state\":\"available\",\"availableUntil\":\"2027-01-01T00:00:00.000Z\"}},"
                + "\"visibility\":" + visibility + "}"));
    }

    void hold(String id, String uuid, String employee, String type, String state) throws SQLException {
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now() + interval '1 day')", ENV, RUN, id, uuid, employee,
                "slot-" + employee, units.merge(employee, 1, Integer::sum), type, state);
    }

    void tick(String id, int clock, String state, String outcome) throws SQLException {
        update("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, input_digest, state, "
                + "last_outcome) VALUES (?, ?, ?, now(), ?, ?, ?, ?)", ENV, RUN, id, clock, "c".repeat(64), state,
                outcome == null ? null : json(outcome));
    }

    DemandResult read() {
        return service.read(SCOPE);
    }

    ObjectNode ok() {
        DemandResult r = read();
        if (r instanceof DemandResult.Ok ok) return ok.value();
        throw new AssertionError("expected ok but was " + r);
    }

    @Override
    public void close() throws SQLException {
        if (seedConnection != null) seedConnection.close();
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    // ---- stub ports ----

    /** Reads the retained Node policy seed (never a copy), with the decline reasons supplied explicitly. */
    static final class Policy implements DemandPolicyPort {
        volatile JsonNode threshold = M.getNodeFactory().numberNode(1);
        volatile boolean absent;
        volatile String version = POLICY;
        volatile JsonNode declineReasons = reasons(REASONS);
        volatile JsonNode exclusion;

        static JsonNode reasons(List<String> codes) {
            ObjectNode v = json("{\"schemaVersion\":1,\"reasons\":[]}");
            codes.forEach(c -> ((com.fasterxml.jackson.databind.node.ArrayNode) v.get("reasons")).addObject().put("code", c).put("label", c));
            return v;
        }

        @Override
        public Optional<DemandPolicy> read(String policyVersion, Instant asOf) {
            if (absent) return Optional.empty();
            try {
                Map<String, JsonNode> values = new java.util.HashMap<>();
                for (JsonNode a : M.readTree(Files.readString(SEED)).get("assumptions")) values.put(a.get("key").asText(), a.get("value"));
                return Optional.of(new DemandPolicy(version, threshold, "assumed", declineReasons,
                        exclusion != null ? exclusion : values.get("offer.declinedCar.exclusion"),
                        values.get("employee.recommendation.v1").get("essentials"), values.get("allocation.tieBreak.rule")));
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** Every available car is eligible unless a rule says otherwise; counts its calls. */
    static final class Evaluator implements UnmetEvaluationPort {
        volatile Function<BriefCandidate, List<CarDecision>> rule = b -> b.cars().stream().map(c -> "available".equals(c.availabilityState())
                ? new CarDecision(c.orderUuid(), "eligible", List.of(), List.of())
                : new CarDecision(c.orderUuid(), "ineligible", List.of(new UnmetEvaluationPort.Gate("car-unavailable", null)), List.of())).toList();
        volatile boolean unavailable;
        final AtomicInteger calls = new AtomicInteger();
        volatile List<BriefCandidate> last = List.of();

        @Override
        public Evaluation evaluate(DemandScope scope, List<BriefCandidate> candidates, Instant asOf) {
            calls.incrementAndGet();
            last = candidates;
            if (unavailable) return Evaluation.UNAVAILABLE;
            Map<String, List<CarDecision>> out = new java.util.HashMap<>();
            candidates.forEach(c -> out.put(c.employeeId(), rule.apply(c)));
            return new Evaluation.Ok(out);
        }
    }

    static final class Offers implements OfferRecordsPort {
        final List<OfferRow> offers = new ArrayList<>();
        final List<DecisionRow> decisions = new ArrayList<>();
        volatile boolean absent;
        volatile Connection seen;
        volatile boolean sawSnapshot;

        @Override
        public Optional<OfferRecords> read(Connection snapshot, DemandScope scope) throws SQLException {
            seen = snapshot;
            sawSnapshot = !snapshot.getAutoCommit() && snapshot.isReadOnly()
                    && snapshot.getTransactionIsolation() == Connection.TRANSACTION_REPEATABLE_READ;
            if (absent) return Optional.empty();
            try (PreparedStatement ps = snapshot.prepareStatement("SELECT 1"); ResultSet rs = ps.executeQuery()) {
                rs.next();
            }
            return Optional.of(new OfferRecords(List.copyOf(offers), List.copyOf(decisions)));
        }
    }
}
