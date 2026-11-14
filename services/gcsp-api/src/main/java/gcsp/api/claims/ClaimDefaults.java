package gcsp.api.claims;

import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

/** Production defaults; each is replaced by providing another bean of the port type. */
@ApplicationScoped
public class ClaimDefaults {

    /** Manual browse and eligibility are not built in Java yet (FUCQ-461/442), so every claim is unavailable. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    ManualSelectionPort selection() {
        return new UnconfiguredManualSelection();
    }

    /** No buddy offers table is connected yet (FUCQ-464), so a held slot reports no offer id. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    SlotOccupancyPort occupancy() {
        return new NoOfferLookup();
    }

    @Produces
    @DefaultBean
    @ApplicationScoped
    ClaimTimingPort timing(PolicyService policy) {
        return new PolicyClaimTiming(policy);
    }

    @Produces
    @DefaultBean
    @ApplicationScoped
    ClaimClock claimClock(PolicyClock clock) {
        return new PolicyClaimClock(clock);
    }
}
