package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Consumer;
import javax.sql.DataSource;

/** One migrated schema plus the ports a ReturnPlans needs; {@link #restart} builds a fresh service on a new pool. */
final class PlansHarness implements AutoCloseable {

    static final String ORDER = "order-1";
    static final String EMP = "emp-1";
    static final AppointmentSlot HANDOVER_SLOT = new AppointmentSlot("slot-20261107T0900Z",
            Instant.parse("2026-11-07T09:00:00Z"), Instant.parse("2026-11-07T10:00:00Z"));
    static final ReturnPlans.Caller PAULA = ReturnPlans.Caller.employee(EMP);

    final ReturnsFixture f;
    final InMemoryReturnSource source = new InMemoryReturnSource();
    final FakeHandover handover = new FakeHandover();
    final ReturnClockStub clock = new ReturnClockStub();
    final RetainedReturnPolicy policy;
    final FlakyReturnProvider provider;
    ReturnPlans plans;
    private final java.util.List<DataSource> pools = new java.util.ArrayList<>();

    /** A settable demo clock; never the wall clock. */
    static final class ReturnClockStub implements ReturnClock {
        volatile Instant now = ReturnsFixture.T0;

        @Override
        public Optional<Instant> now(RunContext ctx) {
            return Optional.of(now);
        }
    }

    PlansHarness(Path dir, Consumer<ObjectNode> policyEdit) throws Exception {
        f = ReturnsFixture.create();
        policy = ReturnsFixture.policyFile(dir, policyEdit);
        provider = new FlakyReturnProvider(new SyntheticReturnProvider(f.pool()));
        source.put(InMemoryReturnSource.replacement(ORDER, EMP));
        handover.put(ORDER, new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-HANDOVER1"));
        restart(provider);
    }

    /** A new ReturnPlans over a new pool, as after a service restart. */
    ReturnPlans restart(ReturnProviderPort p) throws Exception {
        if (plans != null) plans.close();
        DataSource pool = f.pool();
        pools.add(pool);
        plans = new ReturnPlans(policy, source, handover, clock, p, new CurrentCarStore(pool), new TransactionRunner(pool), pool);
        return plans;
    }

    RunContext ctx() {
        return f.ctx();
    }

    PlanResult read(String order) {
        return plans.read(ctx(), PAULA, order);
    }

    JsonNode plan() {
        return ok(read(ORDER));
    }

    PlanResult request(String commandId, String choice, String slotId, long version) {
        return plans.request(ctx(), PAULA, commandId, ORDER, choice, slotId, version);
    }

    /** The first slot a choice offers, from the read model. */
    String firstSlot(String choice) {
        return plan().path("offeredSlots").path(choice).get(0).path("slotId").asText();
    }

    static JsonNode ok(PlanResult r) {
        return assertInstanceOf(PlanResult.Ok.class, r, String.valueOf(r)).json();
    }

    static PlanResult.Refused refused(PlanResult r) {
        return assertInstanceOf(PlanResult.Refused.class, r, String.valueOf(r));
    }

    static void assertRefused(int http, String code, PlanResult r) {
        PlanResult.Refused x = refused(r);
        assertEquals(code, x.code(), x.reason());
        assertEquals(http, x.http());
    }

    ReturnPlans.Summary progress(boolean retry) {
        return plans.progress(ctx(), clock.now, retry);
    }

    void advance(long seconds) {
        clock.now = clock.now.plusSeconds(seconds);
    }

    @Override
    public void close() throws Exception {
        if (plans != null) plans.close();
        f.close();
    }
}
