package gcsp.api.offers;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.WallPolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Typed;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Optional;

/**
 * The instant offers treat as now. On the deployed composition that is the run clock, as buddy holds are stamped from
 * it; a PolicyClock bound by a test or deployment is still honoured. Not a PolicyClock bean, so it never replaces it.
 */
@ApplicationScoped
@Typed(OfferClock.class)
public class OfferClock implements PolicyClock {

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

    OfferClock() {}

    /** Plain wiring: the policy clock, whether it is the default wall clock, and the run clock when persistence is on. */
    OfferClock(PolicyClock policy, RunTime runTime) {
        this.policy = policy;
        this.runTime = runTime;
    }

    /** Null means no trustworthy now: callers answer unavailable and never fall back to wall time. */
    @Override
    public Instant now(RunContext ctx) {
        if (!(policy instanceof WallPolicyClock)) return policy.now(ctx);
        RunTime run = runTime();
        if (run == null) return policy.now(ctx);
        return run.now(ctx).orElse(null);
    }

    private RunTime runTime() {
        if (runTime != null) return runTime;
        if (holder == null || !holder.available()) return null;
        return ctx -> {
            try {
                return holder.clock().now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
            } catch (ClockUnavailableException e) {
                return Optional.empty();
            }
        };
    }
}
