package gcsp.api.production;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** The demo clock Production requests are stamped with. */
public interface ProductionClock {

    Optional<Instant> now(RunContext ctx);
}
