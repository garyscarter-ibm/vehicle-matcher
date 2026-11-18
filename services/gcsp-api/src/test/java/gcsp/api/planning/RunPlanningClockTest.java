package gcsp.api.planning;

import static gcsp.api.planning.PlanningFixtures.M;
import static gcsp.api.planning.PlanningFixtures.POLICY;
import static gcsp.api.planning.PlanningFixtures.principal;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The run clock as the planning clock: no database, the run clock reader and the persistence switch are stubbed. */
class RunPlanningClockTest {

    private static final RunContext CTX = new RunContext("env-1", "run-1", "sub-greg");
    private static final Instant WALL = Instant.parse("2026-11-06T00:00:00.000Z");
    private static final Instant RUN_AHEAD = Instant.parse("2026-11-08T12:30:00.000Z");

    @TempDir
    java.nio.file.Path dir;

    private final AtomicInteger wallCalls = new AtomicInteger();
    private final PlanningClock wall = context -> {
        wallCalls.incrementAndGet();
        return new PlanningClock.Observation(WALL, RunPlanningClock.WALL_VERSION);
    };

    private RunPlanningClock on(RunPlanningClock.Reader reader) {
        return new RunPlanningClock(() -> true, reader, wall);
    }

    @Test
    void aRunClockAheadOfWallTimeIsObservedAsItsOwnInstantAndVersion() {
        RunPlanningClock clock = on((env, run) -> {
            assertEquals("env-1", env);
            assertEquals("run-1", run);
            return Optional.of(new ClockReading(RUN_AHEAD, 12L));
        });

        PlanningClock.Observation seen = clock.observe(CTX);

        assertEquals(RUN_AHEAD, seen.now());
        assertEquals("12", seen.version());
        assertEquals(0, wallCalls.get());
    }

    @Test
    void aClockVersionChangeShowsAsADifferentObservationAndAnUnchangedOneAsEqual() {
        AtomicInteger version = new AtomicInteger(3);
        RunPlanningClock clock = on((env, run) -> Optional.of(new ClockReading(RUN_AHEAD, version.get())));

        PlanningClock.Observation first = clock.observe(CTX);
        assertEquals(first, clock.observe(CTX));
        version.incrementAndGet();

        assertEquals("4", clock.observe(CTX).version());
        assertTrue(!first.equals(clock.observe(CTX)));
    }

    @Test
    void anAbsentRunClockFailsAndNeverFallsBackToWallTime() {
        RunPlanningClock clock = on((env, run) -> Optional.empty());

        assertThrows(IllegalStateException.class, () -> clock.observe(CTX));
        assertEquals(0, wallCalls.get());
    }

    @Test
    void anUnreadableRunClockFailsAndNeverFallsBackToWallTime() {
        RunPlanningClock clock = on((env, run) -> {
            throw new ClockUnavailableException("The run clock could not be read.", new RuntimeException());
        });

        assertThrows(ClockUnavailableException.class, () -> clock.observe(CTX));
        assertEquals(0, wallCalls.get());
    }

    @Test
    void withPersistenceOffTheWallClockSemanticsStayAndTheRunClockIsNeverRead() {
        RunPlanningClock clock = new RunPlanningClock(() -> false, (env, run) -> {
            throw new AssertionError("the run clock must not be read");
        }, wall);

        PlanningClock.Observation seen = clock.observe(CTX);

        assertEquals(WALL, seen.now());
        assertEquals("wall-clock", seen.version());
    }

    @Test
    void anUnavailableRunClockMakesTheOrderPlanUnavailableNotAWallTimePlan() throws Exception {
        PlanningFixtures.Ports ports = new PlanningFixtures.Ports();
        PolicyService policy = new PolicyService(new PolicyFiles(dir, "run-clock").source(M.createArrayNode()));
        PlanningClock none = on((env, run) -> Optional.empty());

        ObjectNode out = new OrderPlanService(policy, ports, ports, none).readPlan(principal("greg"), POLICY);

        assertEquals("unavailable", out.get("status").textValue(), out.toString());
        assertEquals("planning-source-unavailable", out.get("code").textValue());
    }
}
