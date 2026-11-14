package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** The demo clock for a run; empty until a presenter tick has set it. Never the wall clock. */
public interface ReturnClock {

    Optional<Instant> now(RunContext ctx);
}
