package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.production.PlanSnapshotPort.Line;
import gcsp.api.production.PlanSnapshotPort.Reading;
import gcsp.api.production.PlanSnapshotPort.Snapshot;
import gcsp.api.production.ProductionProviderPort.Answer;
import gcsp.api.production.ProductionProviderPort.Operation;
import gcsp.api.production.ProductionService.SubmitInput;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh migrated schema with an active run and one delivered tick, a movable plan port and a synthetic provider. */
final class ProductionFixture implements AutoCloseable {

    static final String ENV = "test-env";
    static final Instant T0 = Instant.parse("2026-11-13T09:00:00Z");
    static final String PLAN = "plan-1";
    static final Map<String, String> VERSIONS = Map.of("forecast", "f1", "policy", "p1", "stock", "s1");
    private static final AtomicInteger SERIAL = new AtomicInteger();

    final String url;
    final String schema;
    final Plan plan = new Plan();
    ProductionProviderPort provider;
    ProductionService service;

    /** A plan port the test can edit between calls. */
    static final class Plan implements PlanSnapshotPort {
        volatile Reading reading = snapshot(PLAN, VERSIONS, true, line("l1", "3 Series Saloon", "320i", 5),
                line("l2", "i5 Touring", "eDrive40", 3));

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public Reading current(RunContext ctx) {
            return reading;
        }
    }

    private ProductionFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    static Line line(String id, String model, String derivative, int quantity) {
        return new Line(id, model, derivative, quantity);
    }

    static Snapshot snapshot(String planId, Map<String, String> versions, boolean feasible, Line... lines) {
        return new Snapshot(planId, versions, feasible, T0, List.of(lines));
    }

    /** Never skips quietly: a missing URL fails, because every production test must run. */
    static ProductionFixture create() throws SQLException {
        return create(true);
    }

    /** withTick false leaves the run without a delivered tick, so the demo clock is unavailable. */
    static ProductionFixture create(boolean withTick) throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_p_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SERIAL.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ProductionFixture f = new ProductionFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-1', 'active')", ENV);
        if (withTick) {
            f.update("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, input_digest, "
                    + "state) VALUES (?, 'run-1', 'tick-1', ?, 1, ?, 'pending')", ENV, java.sql.Timestamp.from(T0), "0".repeat(64));
        }
        f.synthetic = new SyntheticProductionProvider(f.pool());
        f.use(f.synthetic);
        return f;
    }

    SyntheticProductionProvider synthetic;

    void use(ProductionProviderPort p) throws SQLException {
        provider = p;
        service = service(pool(), p);
    }

    ProductionService service(PGSimpleDataSource pool, ProductionProviderPort p) {
        return new ProductionService(pool, p, plan, new TickProductionClock(pool));
    }

    RunContext ctx() {
        return new RunContext(ENV, "run-1", "greg-1");
    }

    SubmitInput input(String commandId) {
        return new SubmitInput(commandId, PLAN, VERSIONS);
    }

    ProductionResult submit(String commandId) {
        return service.submit(ctx(), input(commandId));
    }

    static JsonNode value(ProductionResult r) {
        return switch (r) {
            case ProductionResult.Ok ok -> ok.value();
            case ProductionResult.Pending p -> p.value();
            default -> throw new IllegalStateException("not a value: " + r);
        };
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

    /** Row counts a replayed or refused command must leave exactly as they were. */
    List<Long> footprint() throws SQLException {
        return List.of(count("SELECT count(*) FROM production_submissions"), count("SELECT count(*) FROM production_requests"),
                count("SELECT count(*) FROM production_responses"), count("SELECT count(*) FROM production_confirmations"),
                count("SELECT count(*) FROM production_synthetic_orders"),
                count("SELECT count(*) FROM production_synthetic_responses"), count("SELECT count(*) FROM command_receipts"),
                count("SELECT revision FROM runs"));
    }

    String stateOf(String lineId) throws SQLException {
        return text("SELECT state FROM production_requests WHERE line_id = ?", lineId);
    }

    String requestId(String lineId) throws SQLException {
        return text("SELECT request_id FROM production_requests WHERE line_id = ?", lineId);
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    /** Forwards to the synthetic provider, then misbehaves on the first N submits: the answer is lost or never recorded. */
    static final class Wrapper implements ProductionProviderPort {
        enum Mode { LOSE_RESPONSE, DOWN_BEFORE_RECORDING }

        final ProductionProviderPort inner;
        final Mode mode;
        final AtomicInteger failuresLeft;
        final AtomicInteger submits = new AtomicInteger();
        final AtomicInteger reconciles = new AtomicInteger();

        Wrapper(ProductionProviderPort inner, Mode mode, int failures) {
            this.inner = inner;
            this.mode = mode;
            this.failuresLeft = new AtomicInteger(failures);
        }

        @Override
        public String mode() {
            return inner.mode();
        }

        @Override
        public Description describe() {
            return inner.describe();
        }

        @Override
        public Answer submit(Operation op) {
            submits.incrementAndGet();
            if (failuresLeft.getAndUpdate(n -> Math.max(0, n - 1)) > 0) {
                if (mode == Mode.LOSE_RESPONSE) {
                    inner.submit(op);
                    throw new IllegalStateException("response lost");
                }
                return Answer.of(ProductionProviderPort.Status.UNAVAILABLE, op.operationId(), "production-store-unavailable", "down");
            }
            return inner.submit(op);
        }

        @Override
        public Answer reconcile(Operation op) {
            reconciles.incrementAndGet();
            return inner.reconcile(op);
        }
    }

    /** Answers every submit with a fixed Answer built from the operation, for a provider that already did more. */
    static final class Scripted implements ProductionProviderPort {
        final java.util.function.Function<Operation, Answer> answer;

        Scripted(java.util.function.Function<Operation, Answer> answer) {
            this.answer = answer;
        }

        @Override
        public String mode() {
            return "synthetic";
        }

        @Override
        public Description describe() {
            return new Description("synthetic", "scripted", "v", "available", List.of());
        }

        @Override
        public Answer submit(Operation op) {
            return answer.apply(op);
        }

        @Override
        public Answer reconcile(Operation op) {
            return answer.apply(op);
        }
    }

    static Optional<String> first(JsonNode requests, String lineId, String field) {
        for (JsonNode r : requests) if (lineId.equals(r.get("lineId").asText())) return Optional.ofNullable(r.get(field).asText(null));
        return Optional.empty();
    }
}
