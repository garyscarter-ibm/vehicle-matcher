package gcsp.api.claims;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Optional;
import java.util.function.BooleanSupplier;

/** Claims use the caller's persisted presenter clock; persistence-off retains the existing policy-clock semantics. */
public final class RunClaimClock implements ClaimClock {
    @FunctionalInterface
    interface Reader {
        Optional<ClockReading> now(String environmentId, String runId);
    }

    private final BooleanSupplier persistenceActive;
    private final Reader reader;
    private final ClaimClock whenOff;

    RunClaimClock(BooleanSupplier persistenceActive, Reader reader, ClaimClock whenOff) {
        this.persistenceActive = persistenceActive;
        this.reader = reader;
        this.whenOff = whenOff;
    }

    @Override
    public Instant now(RunContext context) {
        if (!persistenceActive.getAsBoolean()) return whenOff.now(context);
        Optional<ClockReading> reading = reader.now(context.environmentId(), context.runId());
        if (reading == null || reading.isEmpty()) {
            throw new IllegalStateException("The active run has no readable claim clock.");
        }
        return reading.get().now();
    }

    /** Displaces the unchanged default PolicyClaimClock without changing the global PolicyClock bean. */
    @ApplicationScoped
    static class Wiring {
        @Inject RunClockHolder holder;
        @Inject PolicyClock policyClock;

        @Produces
        @ApplicationScoped
        ClaimClock claimClock() {
            return new RunClaimClock(holder::available,
                    (environmentId, runId) -> holder.clock().now(environmentId, runId), new PolicyClaimClock(policyClock));
        }
    }
}
