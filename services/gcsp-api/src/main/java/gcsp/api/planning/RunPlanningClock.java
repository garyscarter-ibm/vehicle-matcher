package gcsp.api.planning;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import java.util.Optional;
import java.util.function.BooleanSupplier;

/**
 * The presenter run clock as the planning clock (FUCQ-477): release, confirmation and response stamps are on it, so
 * asOf and the version pin must be too. Persistence on never falls back to wall time; a missing clock throws.
 */
public final class RunPlanningClock implements PlanningClock {

    /** One selected read of the active run's clock; empty when the run is not active or has no clock row. */
    @FunctionalInterface
    interface Reader {
        Optional<ClockReading> now(String environmentId, String runId);
    }

    /** The constant version WallPlanningClock gives; the persistence-off semantics are unchanged. */
    static final String WALL_VERSION = "wall-clock";

    private final BooleanSupplier persistenceActive;
    private final Reader reader;
    private final PlanningClock whenOff;

    RunPlanningClock(BooleanSupplier persistenceActive, Reader reader, PlanningClock whenOff) {
        this.persistenceActive = persistenceActive;
        this.reader = reader;
        this.whenOff = whenOff;
    }

    /** Throws (callers turn it into a planning unavailable outcome) when the run clock cannot be read. */
    @Override
    public Observation observe(RunContext context) {
        if (!persistenceActive.getAsBoolean()) {
            return whenOff.observe(context);
        }
        Optional<ClockReading> reading = reader.now(context.environmentId(), context.runId());
        if (reading == null || reading.isEmpty()) {
            throw new IllegalStateException("The active run has no readable run clock.");
        }
        return new Observation(reading.get().now(), Long.toString(reading.get().clockVersion()));
    }

    /** Displaces the wall default bean; with persistence off it returns the same wall semantics the default has. */
    @ApplicationScoped
    static class Wiring {

        @Inject
        RunClockHolder holder;

        @Inject
        PolicyClock policyClock;

        @Produces
        @ApplicationScoped
        PlanningClock planningClock() {
            PlanningClock wall = context -> new PlanningClock.Observation(policyClock.now(context), WALL_VERSION);
            return new RunPlanningClock(holder::available, (environmentId, runId) -> holder.clock().now(environmentId, runId), wall);
        }
    }
}
