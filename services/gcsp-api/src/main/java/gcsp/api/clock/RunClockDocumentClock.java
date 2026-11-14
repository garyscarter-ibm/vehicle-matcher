package gcsp.api.clock;

import gcsp.api.documents.DocumentClock;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Optional;

/** The documents' clock is the run clock; empty when persistence is off, the run has no clock or it cannot be read. */
@ApplicationScoped
public class RunClockDocumentClock implements DocumentClock {

    @Inject
    RunClockHolder holder;

    @Override
    public Optional<Instant> now(RunContext ctx) {
        if (!holder.available()) return Optional.empty();
        try {
            return holder.clock().now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
        } catch (ClockUnavailableException e) {
            return Optional.empty();
        }
    }
}
