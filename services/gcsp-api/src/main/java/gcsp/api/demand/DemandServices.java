package gcsp.api.demand;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Clock;
import java.util.Optional;

/** Builds the demand and suitability services lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class DemandServices {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    DemandPolicyPort policy;

    @Inject
    UnmetEvaluationPort evaluation;

    @Inject
    OfferRecordsPort offers;

    @Inject
    AllocationRecordsPort allocations;

    private DemandService demand;
    private SuitabilityService suitability;

    public synchronized Optional<DemandService> demand() {
        if (!persistence.active()) return Optional.empty();
        if (demand == null) demand = new DemandService(dataSource.get(), policy, evaluation, offers, Clock.systemUTC());
        return Optional.of(demand);
    }

    public synchronized Optional<SuitabilityService> suitability() {
        if (!persistence.active()) return Optional.empty();
        if (suitability == null) suitability = new SuitabilityService(dataSource.get(), policy, allocations, Clock.systemUTC());
        return Optional.of(suitability);
    }
}
