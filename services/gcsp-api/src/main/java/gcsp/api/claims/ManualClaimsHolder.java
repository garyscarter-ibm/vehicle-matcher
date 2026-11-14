package gcsp.api.claims;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ManualClaims lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class ManualClaimsHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ClaimClock clock;

    @Inject
    ClaimTimingPort timing;

    @Inject
    ManualSelectionPort selection;

    @Inject
    SlotOccupancyPort occupancy;

    private ManualClaims claims;

    public synchronized Optional<ManualClaims> claims() {
        if (!persistence.active()) return Optional.empty();
        if (claims == null) {
            claims = new ManualClaims(dataSource.get(), persistence.runner(), clock, timing, selection, occupancy);
        }
        return Optional.of(claims);
    }
}
