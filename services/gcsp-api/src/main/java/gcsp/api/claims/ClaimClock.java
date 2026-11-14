package gcsp.api.claims;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** The instant a claim command treats as now; production wraps PolicyClock, tests control it. */
public interface ClaimClock {

    Instant now(RunContext context);
}
