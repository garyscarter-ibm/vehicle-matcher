package gcsp.api.policy;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Optional;

/**
 * The instant Greg's policy requests treat as now: the run clock, which holds still between presenter ticks, so a
 * preview's asOf is still valid when publish checks it. Falls back to the PolicyClock without a readable run clock.
 */
@ApplicationScoped
public class GregPolicyClock {

    /** The run clock's reading for this run, empty when it has none or cannot be read. */
    @FunctionalInterface
    interface RunTime {
        Optional<Instant> now(RunContext ctx);
    }

    @Inject
    PolicyClock policy;

    @Inject
    RunClockHolder holder;

    private RunTime runTime;

    GregPolicyClock() {}

    /** Plain wiring for tests: the fallback clock and the run clock reading. */
    GregPolicyClock(PolicyClock policy, RunTime runTime) {
        this.policy = policy;
        this.runTime = runTime;
    }

    /** Reads the clock once; callers pass the result through the whole request. */
    public Instant now(RunContext ctx) {
        RunTime run = runTime();
        Optional<Instant> reading = run == null ? Optional.empty() : run.now(ctx);
        return reading.isPresent() ? reading.get() : policy.now(ctx);
    }

    private RunTime runTime() {
        if (runTime != null) return runTime;
        if (holder == null || !holder.available()) return null;
        return ctx -> {
            try {
                return holder.clock().now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
            } catch (RuntimeException e) {
                return Optional.empty();
            }
        };
    }
}
