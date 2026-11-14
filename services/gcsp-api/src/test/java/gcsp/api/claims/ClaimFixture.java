package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run, stock and employees, a controllable clock and stub ports. */
final class ClaimFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String VERSION = "gcsp-policy-v1";
    static final Instant T0 = Instant.parse("2026-11-13T09:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();
    private static final AtomicInteger COMMANDS = new AtomicInteger();

    final String url;
    final String schema;
    final Clock clock = new Clock();
    final Selection selection = new Selection();
    final Offers offers = new Offers();
    volatile ClaimTimingPort timing = new Timing();
    ManualClaims claims;

    /** Test clock: moves only when told. */
    static final class Clock implements ClaimClock {
        volatile Instant now = T0;

        @Override
        public Instant now(RunContext context) {
            return now;
        }
    }

    /** Fixed 120 s and 600 s timing, as the seed gives; replace the field for missing-timing tests. */
    static final class Timing implements ClaimTimingPort {
        @Override
        public gcsp.api.claims.ClaimTimingPort.Timing timing(ClaimScope scope, Instant now) {
            return new Known(120, 600, JSON.createArrayNode());
        }
    }

    /** Every employee has slot "slot-" + id, context ctx-1 and draft 1; every car is eligible with the same facts. */
    static final class Selection implements ManualSelectionPort {
        final Map<String, String> context = new ConcurrentHashMap<>();
        volatile ObjectNode terms = JSON.createObjectNode().put("points", 10);
        volatile Instant validUntil = T0.plusSeconds(86_400);
        volatile boolean eligible = true;

        @Override
        public Claimant claimant(ClaimScope scope) {
            return new Known("slot-" + scope.employeeId(), context.getOrDefault(scope.employeeId(), "ctx-1"), 1, "drv-1",
                    scope.policyVersion());
        }

        @Override
        public Decision decide(ClaimScope scope, String orderUuid) {
            if (!eligible) return new NotEligible("not-eligible");
            return new Eligible("cfg-1", facts(), terms.deepCopy(), validUntil);
        }

        static ObjectNode facts() {
            return JSON.createObjectNode().put("colour", "red");
        }
    }

    static final class Offers implements SlotOccupancyPort {
        volatile String offerId;

        @Override
        public java.util.Optional<String> heldOfferId(gcsp.api.persistence.Tx tx, String holdId) {
            return java.util.Optional.ofNullable(offerId);
        }
    }

    private ClaimFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static ClaimFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_c_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ClaimFixture f = new ClaimFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        f.update("CREATE TABLE claims_test_orders (id text PRIMARY KEY)");
        f.claims = f.newClaims();
        return f;
    }

    ManualClaims newClaims() throws SQLException {
        return new ManualClaims(pool(), clock, new ForwardingTiming(this), selection, offers);
    }

    /** Reads the fixture's current timing at call time so a test can swap it. */
    private record ForwardingTiming(ClaimFixture f) implements ClaimTimingPort {
        @Override
        public gcsp.api.claims.ClaimTimingPort.Timing timing(ClaimScope scope, Instant now) {
            return f.timing.timing(scope, now);
        }
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

    // ---- seeding and inputs ----

    /** An employee with slot "slot-" + id (capacity 1). */
    void employee(String id) throws SQLException {
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?)", ENV, RUN, id);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, 1)", ENV, RUN, "slot-" + id, id);
    }

    /** A released car at version 1 with the shared facts. */
    void car(String orderUuid) throws SQLException {
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, 'cfg-1', 'released', ?::jsonb)", ENV, RUN, orderUuid, Selection.facts().toString());
    }

    /** A Buddy hold written straight to the table, as FUCQ-464 would. */
    void buddyHold(String holdId, String orderUuid, String employeeId) throws SQLException {
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'buddy-offer', 'active', now() + interval '1 hour')",
                ENV, RUN, holdId, orderUuid, employeeId, "slot-" + employeeId);
    }

    ClaimScope scope(String employeeId) {
        return new ClaimScope(ENV, RUN, "actor-" + employeeId, employeeId, VERSION);
    }

    ClaimScope system() {
        return new ClaimScope(ENV, RUN, "system", "system", VERSION);
    }

    String digest() {
        return ManualClaims.termsDigest(VERSION, selection.terms);
    }

    static String commandId() {
        return "cmd-" + COMMANDS.incrementAndGet();
    }

    ObjectNode claimInput(String commandId, String orderUuid, long stockVersion) {
        ObjectNode n = JSON.createObjectNode();
        n.put("commandId", commandId);
        n.put("orderUuid", orderUuid);
        n.put("expectedStockVersion", stockVersion);
        n.put("expectedDraftVersion", 1);
        n.put("expectedContextVersion", "ctx-1");
        n.put("expectedTermsDigest", digest());
        return n;
    }

    ObjectNode claimInput(String orderUuid) {
        return claimInput(commandId(), orderUuid, 1);
    }

    static ObjectNode actionInput(String commandId, String holdId, long holdVersion) {
        ObjectNode n = JSON.createObjectNode();
        n.put("commandId", commandId);
        n.put("holdId", holdId);
        n.put("expectedHoldVersion", holdVersion);
        n.put("expectedDraftVersion", 1);
        return n;
    }

    static ObjectNode releaseInput(String commandId, String holdId, long holdVersion, String reason) {
        return actionInput(commandId, holdId, holdVersion).put("reason", reason);
    }

    /** Claims one car for the employee and returns the hold node of the answer. */
    JsonNode claimOk(String employeeId, String orderUuid) {
        return value(claims.claim(scope(employeeId), claimInput(orderUuid))).get("hold");
    }

    static JsonNode value(ClaimResult r) {
        if (!(r instanceof ClaimResult.Ok ok)) throw new IllegalStateException("not ok: " + r);
        return ok.value();
    }

    static String code(ClaimResult r) {
        return r.code();
    }

    /** Runs both at the same moment on separate connections; results come back in input order. */
    static <T> List<T> race(Callable<T> a, Callable<T> b) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Future<T> fa = pool.submit(() -> gated(ready, go, a));
            Future<T> fb = pool.submit(() -> gated(ready, go, b));
            ready.await();
            go.countDown();
            return List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    private static <T> T gated(CountDownLatch ready, CountDownLatch go, Callable<T> c) throws Exception {
        ready.countDown();
        go.await();
        return c.call();
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

    long carVersion(String orderUuid) throws SQLException {
        return count("SELECT version FROM stock_cars WHERE order_uuid = ?", orderUuid);
    }

    long holdsOn(String orderUuid) throws SQLException {
        return count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state IN "
                + "('active', 'claim-pending', 'release-pending', 'selection-pending')", orderUuid);
    }

    long revision() throws SQLException {
        return count("SELECT revision FROM runs WHERE run_id = ?", RUN);
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
