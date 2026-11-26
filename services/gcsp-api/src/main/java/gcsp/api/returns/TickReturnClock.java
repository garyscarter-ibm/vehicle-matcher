package gcsp.api.returns;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** Reads the FUCQ-479 run clock, independently of the selected supply provider. */
public final class TickReturnClock implements ReturnClock {

    @FunctionalInterface
    interface Reader {
        Optional<ClockReading> now(String environmentId, String runId);
    }

    private final Reader reader;

    public TickReturnClock(RunClockHolder holder) {
        this((environmentId, runId) -> holder.available()
                ? holder.clock().now(environmentId, runId)
                : Optional.empty());
    }

    TickReturnClock(Reader reader) {
        this.reader = reader;
    }

    /** An unreadable run clock uses the returns' existing IllegalStateException unavailable boundary. */
    @Override
    public Optional<Instant> now(RunContext ctx) {
        try {
            return reader.now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
        } catch (ClockUnavailableException e) {
            throw new IllegalStateException("The demo clock could not be read", e);
        }
    }
}
