package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalService.Reader;
import gcsp.api.approvals.ApprovalService.TickInput;
import gcsp.api.auth.Role;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run, the approval service over stub ports, and a tick driver. */
final class ApprovalFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "test-env";
    static final String VERSION = "gcsp-policy-v1";
    static final Instant T0 = Instant.parse("2026-11-13T09:00:00Z");
    static final List<String> FULL = List.of("HR approval", "sales-manager approval", "sent to ordering");
    static final List<String> SHORT = List.of("sales-manager approval", "sent to ordering");
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final AtomicInteger SERIAL = new AtomicInteger();

    final String url;
    final String schema;
    final Policy policy = new Policy();
    final Orders orders = new Orders();
    final ReaderAs greg = new ReaderAs();
    ApprovalStatusProvider status;
    ApprovalService service;
    private int ticks;

    private ApprovalFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static ApprovalFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_a_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ApprovalFixture f = new ApprovalFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        f.status = new SyntheticApprovalStatus(f.pool());
        f.service = f.newService(f.pool(), f.status);
        return f;
    }

    ApprovalService newService(PGSimpleDataSource pool, ApprovalStatusProvider provider) {
        return new ApprovalService(pool, policy, orders, provider, new NoHandover());
    }

    void use(ApprovalStatusProvider provider) throws SQLException {
        status = provider;
        service = newService(pool(), provider);
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
        return new RunContext(ENV, "run-1", "caller");
    }

    static Reader employee(String id) {
        return new Reader(Role.EMPLOYEE, id);
    }

    static final class ReaderAs {
        final Reader greg = new Reader(Role.GREG, null);
        final Reader presenter = new Reader(Role.PRESENTER, null);
    }

    /** The next presenter tick: a fresh id, one hour on, a rising clock version. */
    TickInput nextTick() {
        ticks++;
        return new TickInput("tick-" + ticks, T0.plus(ticks, ChronoUnit.HOURS), ticks);
    }

    ApprovalResult tick() {
        return service.tick(ctx(), nextTick());
    }

    void ticks(int n) {
        for (int i = 0; i < n; i++) {
            ApprovalResult r = tick();
            if (!(r instanceof ApprovalResult.Ok)) throw new IllegalStateException("tick failed: " + r);
        }
    }

    JsonNode view(String orderUuid) {
        return value(service.read(ctx(), greg.greg, orderUuid));
    }

    static JsonNode value(ApprovalResult r) {
        if (!(r instanceof ApprovalResult.Ok ok)) throw new IllegalStateException("not ok: " + r);
        return ok.value();
    }

    /** Ticks until the order's outcome is no longer in-progress; fails after the limit. */
    JsonNode untilDone(String orderUuid, int limit) {
        for (int i = 0; i < limit; i++) {
            JsonNode v = view(orderUuid);
            if (!"in-progress".equals(v.path("outcome").asText())) return v;
            ticks(1);
        }
        throw new IllegalStateException("lifecycle did not finish");
    }

    static List<String> states(JsonNode view) {
        List<String> out = new ArrayList<>();
        for (JsonNode s : view.get("stages")) out.add(s.get("stage").asText() + ":" + s.get("state").asText());
        return out;
    }

    // ---- stub ports ----

    static OrderSourcePort.SelectionOrder order(String uuid, String employee, List<String> stages) {
        ObjectNode source = JSON.createObjectNode();
        source.put("operationId", "sel-" + uuid);
        source.put("operationType", "selection-order");
        source.put("sourceType", "cart");
        source.putNull("holdId");
        source.put("orderNumber", "N-" + uuid);
        source.put("orderReference", "GCSP-" + uuid);
        source.put("configurationId", "cfg-1");
        source.put("receivedAt", "2026-11-13T08:00:00.000Z");
        source.put("policyVersion", VERSION);
        ArrayNodeHelper.stages(source, stages);
        return new OrderSourcePort.SelectionOrder(uuid, employee, "slot-" + employee, "renewal-" + employee, "manual",
                source, stages, VERSION, Instant.parse("2026-11-13T08:00:00Z"), "sel-" + uuid,
                "synthetic-ordering:v1:sel-" + uuid);
    }

    static final class ArrayNodeHelper {
        static void stages(ObjectNode source, List<String> stages) {
            var a = source.putArray("approvalStages");
            stages.forEach(a::add);
        }
    }

    /** Reads the retained Node seed (never a copy) for the four lifecycle keys, with optional edits and faults. */
    static final class Policy implements ApprovalPolicyPort {
        final Map<String, Consumer<ObjectNode>> edits = new HashMap<>();
        volatile Read fault;
        volatile boolean throwing;

        void edit(String key, Consumer<ObjectNode> change) {
            edits.put(key, change);
        }

        @Override
        public Read entries(String policyVersion, List<String> keys) {
            if (throwing) throw new IllegalStateException("policy source down");
            if (fault != null) return fault;
            try {
                JsonNode seed = JSON.readTree(Files.readString(SEED));
                Map<String, JsonNode> found = new LinkedHashMap<>();
                for (JsonNode a : seed.get("assumptions")) {
                    String key = a.get("key").asText();
                    if (!keys.contains(key) || !policyVersion.equals(a.get("policyVersion").asText())) continue;
                    ObjectNode copy = a.deepCopy();
                    if (edits.containsKey(key)) edits.get(key).accept(copy);
                    found.put(key, copy);
                }
                return found.isEmpty() ? new VersionNotFound() : new Found(policyVersion, found);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** In-memory acknowledged selection orders, listed keyset by orderUuid. */
    static final class Orders implements OrderSourcePort {
        final TreeMap<String, Found> byId = new TreeMap<>();

        void ready(OrderSourcePort.SelectionOrder o) {
            byId.put(o.orderUuid(), new Ready(o));
        }

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public Found find(RunContext ctx, String orderUuid) {
            return byId.getOrDefault(orderUuid, new NotFound());
        }

        @Override
        public Listing list(RunContext ctx, String after, int limit) {
            List<SelectionOrder> ready = new ArrayList<>();
            List<InvalidRow> invalid = new ArrayList<>();
            String last = null;
            int taken = 0;
            for (Map.Entry<String, Found> e : byId.tailMap(after == null ? "" : after, false).entrySet()) {
                if (taken == limit) break;
                taken++;
                last = e.getKey();
                if (e.getValue() instanceof Ready r) ready.add(r.order());
                else if (e.getValue() instanceof Invalid i) invalid.add(new InvalidRow(e.getKey(), i.employeeId()));
            }
            boolean more = last != null && byId.higherKey(last) != null;
            return new Page(ready, invalid, more ? last : null);
        }
    }

    // ---- counting helpers ----

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

    long revision() throws SQLException {
        return count("SELECT revision FROM runs WHERE run_id = 'run-1'");
    }

    /** Row counts that a replayed tick must leave exactly as they were. */
    List<Long> snapshot() throws SQLException {
        List<Long> out = new ArrayList<>();
        for (String t : List.of("approval_orders", "approval_revisions", "approval_decisions", "approval_ticks",
                "approval_synthetic_decisions", "command_receipts", "outbox_events")) {
            out.add(count("SELECT count(*) FROM " + t));
        }
        out.add(revision());
        out.add(count("SELECT coalesce(sum(ticks_elapsed + version), 0) FROM approval_decisions"));
        return out;
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
