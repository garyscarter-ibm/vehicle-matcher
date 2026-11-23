package gcsp.api.claims;

import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import java.time.Instant;

/** The retained policy-clock adapter used when persistence is off; persisted claims use RunClaimClock. */
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
