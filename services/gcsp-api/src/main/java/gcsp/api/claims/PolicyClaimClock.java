package gcsp.api.claims;

import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import java.time.Instant;

/** The production claim clock: whatever PolicyClock says (the wall clock until the presenter clock replaces it). */
public final class PolicyClaimClock implements ClaimClock {

    private final PolicyClock clock;

    public PolicyClaimClock(PolicyClock clock) {
        this.clock = clock;
    }

    @Override
    public Instant now(RunContext context) {
        return clock.now(context);
    }
}
