package gcsp.api.claims;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** The instant a claim treats as now: scoped persisted run time, or the policy clock with persistence off. */
public interface ClaimClock {

    Instant now(RunContext context);
}
