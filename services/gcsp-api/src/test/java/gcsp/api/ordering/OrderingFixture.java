package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.PolicySourceException;
import gcsp.api.policy.RetainedFilePolicySource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run, two employees with a hold each, and an ordering service over them. */
final class OrderingFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String VERSION = "gcsp-policy-v1";
    static final Instant NOW = Instant.parse("2026-11-13T12:00:00Z");
    private static final AtomicInteger SERIAL = new AtomicInteger();

    final String url;
    final String schema;
    final EditablePolicy policySource = new EditablePolicy();
    final AtomicReference<Instant> wall = new AtomicReference<>(NOW);
    final TestConverter cart = new TestConverter("cart");
    final TestConverter buddy = new TestConverter("buddy-offer");
    TestProvider provider;
    OrderingService service;

    private OrderingFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static OrderingFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_o_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        OrderingFixture f = new OrderingFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        for (String e : List.of("e1", "e2")) f.seed(e);
        f.provider = new TestProvider(new SyntheticOrderingProvider(f.pool()));
        f.service = f.newService(f.pool(), f.provider);
        return f;
    }

    OrderingService newService(PGSimpleDataSource pool, OrderingPort provider) {
        PolicyService policy = new PolicyService(policySource);
        return new OrderingService(pool, new OrderingTerms(policy, ctx -> NOW), provider, java.time.Duration.ofSeconds(30), wall::get);
    }

    /** The employee, their slot, one car (orderUuid car-e) and an active hold of each type (cart hold-e, buddy hold-b-e). */
    private void seed(String e) throws SQLException {
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?)", ENV, RUN, e);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, ?, ?, 2)",
                ENV, RUN, "slot-" + e, e);
        for (String type : List.of("cart", "buddy-offer")) {
            String car = (type.equals("cart") ? "car-" : "car-b-") + e;
            update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) VALUES (?, ?, ?, 'cfg-1', 'available')",
                    ENV, RUN, car);
            update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                    + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)", ENV, RUN,
                    (type.equals("cart") ? "hold-" : "hold-b-") + e, car, e, "slot-" + e, type.equals("cart") ? 1 : 2, type,
                    java.sql.Timestamp.from(NOW.plusSeconds(3600)));
        }
    }

    static String order(String e) {
        return "1000" + (e.equals("e1") ? "001" : "002");
    }

    OrderingScope scope(String employee) {
        return new OrderingScope(ENV, RUN, employee, "slot-" + employee, VERSION);
    }

    RunContext ctx() {
        return new RunContext(ENV, RUN, "caller");
    }

    String termsDigest(String employee) {
        return ((OrderingResult.Ok) service.terms(scope(employee))).value().get("termsDigest").asText();
    }

    /** A valid cart (or buddy-offer) body for the employee; declarations are the new-car pair. */
    ObjectNode body(String e, boolean buddyOffer, String commandId) {
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", commandId);
        ObjectNode s = b.putObject("source");
        s.put("type", buddyOffer ? "buddy-offer" : "cart").put("holdId", (buddyOffer ? "hold-b-" : "hold-") + e)
                .put("expectedHoldVersion", 1).put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", "q-" + (buddyOffer ? "b-" : "") + e).put("expectedStockVersion", 1);
        b.put("termsDigest", termsDigest(e));
        b.putObject("declarations").put("terms", true).put("driver", true);
        return b;
    }

    OrderingResult submit(String e, String commandId) {
        return service.submit(scope(e), body(e, false, commandId), cart);
    }

    static JsonNode value(OrderingResult r) {
        return switch (r) {
            case OrderingResult.Ok ok -> ok.value();
            case OrderingResult.Pending p -> p.value();
            default -> throw new IllegalStateException("no value: " + r);
        };
    }

    static String status(OrderingResult r) {
        return value(r).path("status").asText();
    }

    // ---- ports ----

    /** The ordering provider as the service sees it, with a count of execute calls. */
    interface OrderingPort extends OrderingProviderPort {}

    /** Wraps the synthetic provider: counts calls and can lose an answer after the provider recorded it, or go down. */
    static final class TestProvider implements OrderingPort {
        final OrderingProviderPort inner;
        final AtomicInteger executes = new AtomicInteger();
        final AtomicInteger reconciles = new AtomicInteger();
        volatile boolean loseAnswer;
        volatile boolean down;
        volatile boolean reject;
        volatile java.util.concurrent.CountDownLatch entered;
        volatile java.util.concurrent.CountDownLatch release;

        TestProvider(OrderingProviderPort inner) {
            this.inner = inner;
        }

        @Override
        public String mode() {
            return inner.mode();
        }

        @Override
        public String provider() {
            return inner.provider();
        }

        @Override
        public ProviderResponse execute(OrderingScope scope, ProviderRequest r) {
            executes.incrementAndGet();
            if (down) throw new IllegalStateException("provider unreachable");
            if (entered != null) {
                entered.countDown();
                try {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            if (reject) return ProviderResponse.of(Status.REJECTED, scope, r, "synthetic-ordering-refused");
            ProviderResponse resp = inner.execute(scope, r);
            if (loseAnswer) throw new IllegalStateException("response lost");
            return resp;
        }

        @Override
        public ProviderResponse reconcile(OrderingScope scope, ProviderRequest r) {
            reconciles.incrementAndGet();
            if (down) throw new IllegalStateException("provider unreachable");
            return inner.reconcile(scope, r);
        }
    }

    /** The source authority: really validates and allocates the hold and car rows inside the ordering transaction. */
    static final class TestConverter implements SelectionConversionPort {
        final String type;
        final AtomicInteger converts = new AtomicInteger();
        volatile String mode = "new";
        volatile String refuseAfterMutation;

        TestConverter(String type) {
            this.type = type;
        }

        @Override
        public String sourceType() {
            return type;
        }

        @Override
        public Preparation prepare(OrderingScope scope, SourceInput source) {
            ObjectNode driver = JSON.createObjectNode().put("name", "Test Driver");
            return new Prepared(mode, driver, JSON.createObjectNode().put("email", "d@example.test"),
                    JSON.createObjectNode().put("employeeId", scope.employeeId()), JSON.createObjectNode().put("draft", 1));
        }

        @Override
        public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest q) throws SQLException {
            converts.incrementAndGet();
            RunContext c = tx.context();
            Optional<Object[]> hold = tx.first("SELECT version, state, expires_at, hold_type, employee_id, order_uuid "
                    + "FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id = ? FOR UPDATE",
                    rs -> new Object[] {rs.getLong(1), rs.getString(2), rs.getTimestamp(3).toInstant(), rs.getString(4),
                        rs.getString(5), rs.getString(6)}, c.environmentId(), c.runId(), q.holdId());
            if (hold.isEmpty() || !hold.get()[3].equals(type) || !hold.get()[4].equals(scope.employeeId())) return new Refusal("forbidden");
            Object[] h = hold.get();
            if (!"active".equals(h[1]) || (long) h[0] != q.expectedHoldVersion()) return new Refusal("claim-changed");
            if (!((Instant) h[2]).isAfter(q.now())) return new Refusal("claim-expired");
            String uuid = (String) h[5];
            String quoteId = "q-" + (type.equals("cart") ? "" : "b-") + scope.employeeId();
            if (!quoteId.equals(q.expectedQuoteId())) return new Refusal("quote-changed");
            tx.write("UPDATE custody_holds SET state = 'allocated', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND hold_id = ?", c.environmentId(), c.runId(), q.holdId());
            if (refuseAfterMutation != null) return new Refusal(refuseAfterMutation);
            int rows = tx.write("UPDATE stock_cars SET state = 'allocated', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?",
                    c.environmentId(), c.runId(), uuid, q.expectedStockVersion());
            if (rows == 0) return new Refusal("stock-changed");
            ObjectNode quote = JSON.createObjectNode().put("quoteId", quoteId).put("orderUuid", uuid);
            return new Converted(uuid, order(scope.employeeId()), "cfg-1", quote, JSON.createObjectNode().put("colour", "blue"), "renewal-" + scope.employeeId());
        }
    }

    /** The retained seed with optional edits per assumption key, or an unavailable source. */
    static final class EditablePolicy implements PolicySource {
        final RetainedFilePolicySource base = new RetainedFilePolicySource();
        final Map<String, Consumer<ObjectNode>> edits = new HashMap<>();
        volatile boolean down;

        @Override
        public List<JsonNode> loadVersions(String runId) throws PolicySourceException {
            if (down) throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
            List<JsonNode> out = new ArrayList<>();
            for (JsonNode seed : base.loadVersions(runId)) {
                JsonNode copy = seed.deepCopy();
                for (JsonNode a : copy.get("assumptions")) {
                    Consumer<ObjectNode> edit = edits.get(a.get("key").asText());
                    if (edit != null) edit.accept((ObjectNode) a);
                }
                out.add(copy);
            }
            return out;
        }
    }

    // ---- SQL helpers ----

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

    long count(String sql, Object... params) throws SQLException {
        String v = text(sql, params);
        return v == null ? 0 : Long.parseLong(v);
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

    /** Rows a refused command must not leave behind. */
    long written() throws SQLException {
        return count("SELECT (SELECT count(*) FROM pending_operations) + (SELECT count(*) FROM selection_orders) "
                + "+ (SELECT count(*) FROM ordering_reference_counters) + (SELECT count(*) FROM outbox_events) "
                + "+ (SELECT count(*) FROM command_receipts) + (SELECT count(*) FROM ordering_synthetic_receipts)");
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
