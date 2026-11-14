package gcsp.api.documents;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** The run's demo clock (presenter-controlled); empty when unavailable, never the wall clock by default. */
public interface DocumentClock {
    Optional<Instant> now(RunContext ctx);
}
