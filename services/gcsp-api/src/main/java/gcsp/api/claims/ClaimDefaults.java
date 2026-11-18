package gcsp.api.claims;

import gcsp.api.account.ManualStockHolder;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;

/** Production defaults; each is replaced by providing another bean of the port type. */
@ApplicationScoped
public class ClaimDefaults {

    /** The manual browse; without a database or account provider it answers manual-selection-not-configured. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    ManualSelectionPort selection(ManualStockHolder stock, Instance<AgroalDataSource> dataSource) {
        return new ManualSelection(stock::stock, dataSource::get);
    }

    /** The offer id comes from the Buddy hold's attributes (FUCQ-464 writes offerId there). */
    @Produces
    @DefaultBean
    @ApplicationScoped
    SlotOccupancyPort occupancy() {
        return new HoldOfferLookup();
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

    /** Stock is decided locally until a remote stock authority is connected. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    ClaimStockPort claimStock() {
        return new LocalClaimStock();
    }
}
