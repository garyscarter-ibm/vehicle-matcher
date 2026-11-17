package gcsp.api.cases;

import java.time.Instant;
import java.util.Optional;

/** The run clock as case time; empty when the run has no readable clock, which makes the case operation unavailable. */
@FunctionalInterface
public interface CaseClock {

    Optional<Instant> now(String environmentId, String runId);
}
