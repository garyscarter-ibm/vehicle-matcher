package gcsp.api.documents;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import io.quarkus.arc.Arc;
import java.time.Instant;
import java.util.Optional;

/** A DocumentClock mock that answers from the real run clock; reads RunClockHolder so it never calls back into itself. */
public final class RunClockBackedTestClock extends RunClockDocumentClock {

    public RunClockBackedTestClock(DocumentClock ignored) {}

    @Override
    public Optional<Instant> now(RunContext ctx) {
        RunClockHolder holder = Arc.container().instance(RunClockHolder.class).get();
        if (!holder.available()) return Optional.empty();
        try {
            return holder.clock().now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
        } catch (ClockUnavailableException e) {
            return Optional.empty();
        }
    }
}
