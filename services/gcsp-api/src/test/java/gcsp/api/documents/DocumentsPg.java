package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A migrated throwaway schema with an active run, plus the policy, stage, case and clock fakes the service reads. */
final class DocumentsPg implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "test-env";
    static final String VERSION = "gcsp-policy-v1";
    static final String ITEMS = "lifecycle.documents.v1";
    static final String SCENARIO = "lifecycle.documents.scenario.v1";
    static final String SLOT = "slot-paula";
    static final String RENEWAL = "renewal:employee-paula";
    static final List<String> STAGES = List.of("selection received", "HR approval", "sales-manager approval",
            "sent to ordering");
    private static final AtomicInteger RUNS = new AtomicInteger();

    /** One order as the stage producer would describe it (the Node stagePort() shape). */
    static final class StageOrder {
        String employeeId = "employee-paula";
        int approved = 4;
        long revision = 4;
        String slot = SLOT;
        String renewalId = RENEWAL;
        String renewalAuthority = "validated";
        String runId = "run-1";
        String contractVersion = "lifecycle.stages.v1";
        String status = "ok";
        boolean throwOnRead;
    }

    final String url;
    final String schema;
    final RunContext ctx = new RunContext(ENV, "run-1", "actor-1");
    final JsonNode policyRoot;
    final Map<String, StageOrder> stageOrders = Collections.synchronizedMap(new java.util.LinkedHashMap<>());
    /** Case refusals by the order's slot id. */
    final Map<String, String> refusals = new HashMap<>();
    final Map<String, String> schemes = new HashMap<>();
    /** Order ids the producer lists although it holds no lifecycle for them. */
    final List<String> extraListed = new ArrayList<>();
    Instant clockNow = Instant.parse("2026-11-14T09:00:00Z");
    boolean clockEmpty;
    boolean caseUnavailable;

    private DocumentsPg(String url, String schema, JsonNode policyRoot) {
        this.url = url;
        this.schema = schema;
        this.policyRoot = policyRoot;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset; a set but unreachable URL fails. */
    static DocumentsPg create() throws SQLException, IOException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_d_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(RUNS.incrementAndGet());
        PGSimpleDataSource admin = plain(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        JsonNode root = JSON.readTree(Files.readString(
                Path.of("../../server/test/fixtures/gcsp-lifecycle-documents-policy-patch.json")));
        DocumentsPg pg = new DocumentsPg(url, schema, root);
        pg.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        pg.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        return pg;
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

    // ---- policy ----

    ObjectNode assumption(String key) {
        for (JsonNode row : policyRoot.get("assumptions")) {
            if (key.equals(row.get("key").asText())) return (ObjectNode) row;
        }
        throw new IllegalArgumentException(key);
    }

    ObjectNode value(String key) {
        return (ObjectNode) assumption(key).get("value");
    }

    DocumentPolicyPort policyPort() {
        return (key, version) -> {
            for (JsonNode row : policyRoot.get("assumptions")) {
                if (key.equals(row.get("key").asText())) {
                    return Optional.of(new DocumentPolicyPort.Assumption(key, row.get("value"),
                            row.get("unit").asText(), row.get("status").asText(), row.get("basis").asText(),
                            row.get("source").asText(), row.get("sourceDate").asText(),
                            row.get("policyVersion").asText()));
                }
            }
            return Optional.empty();
        };
    }

    // ---- clock ----

    DocumentClock clock() {
        return (c) -> clockEmpty ? Optional.empty() : Optional.of(clockNow);
    }

    void advance(long seconds) {
        clockNow = clockNow.plusSeconds(seconds);
    }

    // ---- stage and case fakes ----

    StageOrder order(String orderUuid) {
        return stageOrders.computeIfAbsent(orderUuid, (k) -> new StageOrder());
    }

    DocumentCasePort casePort() {
        return new DocumentCasePort() {
            @Override
            public StageRead readStage(RunContext c, String orderUuid) {
                StageOrder o = stageOrders.get(orderUuid);
                if (o == null) return new StageRead("not-found", null, null);
                if (o.throwOnRead) throw new IllegalStateException("stage producer down");
                if (!"ok".equals(o.status)) return new StageRead(o.status, null, null);
                return new StageRead("ok", null, stageValue(orderUuid, o));
            }

            @Override
            public OrderList listOrders(RunContext c) {
                List<String> listed = new ArrayList<>(stageOrders.keySet());
                listed.addAll(extraListed);
                return new OrderList("ok", null, listed, List.of(), 0);
            }

            @Override
            public CaseCheck checkCase(RunContext c, String employeeId, OrderAuthority order) {
                if (caseUnavailable) return new CaseCheck.Unavailable("employee-store-down");
                String refusal = refusals.get(order.entitlementSlotId());
                if (refusal != null) return new CaseCheck.Refused(refusal);
                return new CaseCheck.Valid(schemes.getOrDefault(employeeId, "choices-fs-uk"));
            }

            @Override
            public Owner ownerOf(RunContext c, String orderUuid) {
                StageOrder o = stageOrders.get(orderUuid);
                return o == null ? new Owner.NotFound() : new Owner.Owned(o.employeeId);
            }
        };
    }

    private static JsonNode stageValue(String orderUuid, StageOrder o) {
        ObjectNode v = JSON.createObjectNode();
        v.put("contractVersion", o.contractVersion);
        v.put("runId", o.runId);
        v.put("orderUuid", orderUuid);
        v.put("employeeId", o.employeeId);
        v.put("policyVersion", VERSION);
        v.put("lifecycleRevision", o.revision);
        v.put("entitlementSlotId", o.slot);
        v.put("renewalId", o.renewalId);
        v.put("renewalAuthority", o.renewalAuthority);
        ArrayNode stages = v.putArray("stages");
        for (int i = 0; i < STAGES.size(); i++) {
            ObjectNode s = stages.addObject();
            s.put("stage", STAGES.get(i));
            s.put("state", i < o.approved ? "approved" : i == o.approved ? "pending" : "not-started");
            s.put("at", i < o.approved ? "2026-11-05T09:00:00.000Z" : null);
            s.put("providerReference", i <= o.approved ? "SYN-STAGE-" + i : null);
        }
        return v;
    }

    // ---- SQL helpers ----

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

    /** A data source that counts the statements every connection prepares or creates. */
    DataSource counting(List<String> sink) throws SQLException {
        DataSource target = pool();
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    Object result;
                    try {
                        result = method.invoke(target, args);
                    } catch (java.lang.reflect.InvocationTargetException e) {
                        throw e.getCause();
                    }
                    if (!"getConnection".equals(method.getName())) return result;
                    Connection real = (Connection) result;
                    return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                            (p, m, a) -> {
                                if (("prepareStatement".equals(m.getName()) || "createStatement".equals(m.getName()))
                                        && a != null && a.length > 0 && a[0] instanceof String sql) {
                                    synchronized (sink) {
                                        sink.add(sql);
                                    }
                                }
                                try {
                                    return m.invoke(real, a);
                                } catch (java.lang.reflect.InvocationTargetException e) {
                                    throw e.getCause();
                                }
                            });
                });
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
