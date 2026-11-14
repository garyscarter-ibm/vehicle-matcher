package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import javax.sql.DataSource;

/** One migrated schema with a service, a fault-injecting provider, a stage stub, four principals and a presenter clock. */
final class ApptHarness implements AutoCloseable {

    static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";
    static final Instant T0 = Instant.parse("2026-11-05T09:00:00.000Z");
    static final int DELAY = 1800;

    final ApptFixture fx;
    final Path dir;
    final AppointmentPolicy policy;
    final StubStages stages = new StubStages();
    final StubReadiness readiness = new StubReadiness();
    final RunContext run;
    final Principal paula = principal("employee", "employee-paula");
    final Principal alex = principal("employee", "employee-alex");
    final Principal greg = principal("greg", null);
    final Principal presenter = principal("presenter", null);
    final AtomicInteger statements = new AtomicInteger();
    final boolean live;
    DataSource pool;
    Flaky provider;
    AppointmentService service;
    Instant now = T0;
    private int seq;

    private ApptHarness(ApptFixture fx, Path dir, AppointmentPolicy policy, boolean live) {
        this.fx = fx;
        this.dir = dir;
        this.policy = policy;
        this.live = live;
        this.run = fx.ctx();
    }

    static ApptHarness create(boolean live, Consumer<ObjectNode> policyEdit) throws Exception {
        ApptFixture fx = ApptFixture.create();
        Path dir = Files.createTempDirectory("appt-");
        ObjectNode doc = (ObjectNode) ApptFixture.resource("policy.json").deepCopy();
        policyEdit.accept(doc);
        Path file = dir.resolve("policy.json");
        Files.writeString(file, doc.toString());
        ApptHarness h = new ApptHarness(fx, dir, new RetainedFileAppointmentPolicy(file), live);
        h.stages.order(ORDER, "employee-paula", 4);
        h.start();
        h.recordTick(T0);
        return h;
    }

    static ApptHarness create() throws Exception {
        return create(false, d -> {});
    }

    static ApptHarness live() throws Exception {
        return create(true, d -> {});
    }

    /** A service over a brand new data source: what a restarted server would build. */
    void start() throws SQLException {
        if (service != null) service.close();
        pool = fx.pool();
        provider = new Flaky(live ? new LiveAppointmentsStub() : new SyntheticAppointments(fx.pool()));
        service = new AppointmentService(CountingDataSource.wrap(pool, statements), policy, provider, stages, new TickClock(pool),
                readiness);
    }

    static ObjectNode value(ObjectNode doc, String key) {
        for (JsonNode r : doc.get("assumptions")) if (key.equals(r.get("key").asText())) return (ObjectNode) r.get("value");
        throw new IllegalStateException(key);
    }

    Principal principal(String role, String employeeId) {
        return new Principal("subject-" + role + "-" + employeeId, List.of(role), ApptFixture.ENV, "run-1", employeeId,
                "gcsp-policy-v1", List.of());
    }

    // ---- clock ----

    void recordTick(Instant at) {
        now = at;
        ok(service.recordTick(presenter, run, "tick-" + (++seq), at));
    }

    void advance(long seconds) {
        recordTick(now.plusSeconds(seconds));
    }

    /** Delivers a presenter tick at the current time and returns the summary. */
    JsonNode tick() {
        recordTick(now);
        return ok(service.tick(presenter, run, now));
    }

    // ---- calls ----

    JsonNode read(Principal who) {
        return ok(service.read(who, run, ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER)));
    }

    AppointmentResult readResult(Principal who, String orderUuid) {
        return service.read(who, run, ApptFixture.JSON.createObjectNode().put("orderUuid", orderUuid));
    }

    AppointmentResult request(Principal who, String slotId, long expectedVersion) {
        return request(who, ORDER, slotId, expectedVersion, "cmd-" + (++seq));
    }

    AppointmentResult request(Principal who, String orderUuid, String slotId, long expectedVersion, String commandId) {
        ObjectNode in = ApptFixture.JSON.createObjectNode().put("commandId", commandId).put("orderUuid", orderUuid)
                .put("slotId", slotId).put("expectedVersion", expectedVersion);
        return service.request(who, run, in);
    }

    AppointmentResult accept(Principal who, String proposalId, long expectedVersion) {
        return accept(who, proposalId, expectedVersion, "cmd-" + (++seq));
    }

    AppointmentResult accept(Principal who, String proposalId, long expectedVersion, String commandId) {
        ObjectNode in = ApptFixture.JSON.createObjectNode().put("commandId", commandId).put("orderUuid", ORDER)
                .put("proposalId", proposalId).put("expectedVersion", expectedVersion);
        return service.acceptChange(who, run, in);
    }

    List<JsonNode> offered() {
        return read(paula).get("offeredSlots").findValues("slotId").isEmpty() ? List.of()
                : java.util.stream.StreamSupport.stream(read(paula).get("offeredSlots").spliterator(), false).toList();
    }

    String firstSlot() {
        return offered().get(0).get("slotId").asText();
    }

    long count(String sql, Object... params) throws SQLException {
        return fx.count(sql, params);
    }

    static JsonNode ok(AppointmentResult r) {
        return assertInstanceOf(AppointmentResult.Ok.class, r, String.valueOf(r)).value();
    }

    static void assertConflict(String code, AppointmentResult r) {
        assertEquals(code, assertInstanceOf(AppointmentResult.Conflict.class, r, String.valueOf(r)).code());
    }

    @Override
    public void close() throws Exception {
        service.close();
        try (var files = Files.walk(dir)) {
            files.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        }
        fx.close();
    }
}
