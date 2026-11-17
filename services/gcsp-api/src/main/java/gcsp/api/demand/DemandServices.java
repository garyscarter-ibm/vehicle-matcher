package gcsp.api.demand;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
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

    @Inject
    RunClockHolder clockHolder;

    private DemandService demand;
    private SuitabilityService suitability;

    public synchronized Optional<DemandService> demand() {
        if (!persistence.active()) return Optional.empty();
        if (demand == null) demand = new DemandService(dataSource.get(), policy, evaluation, offers, runClock());
        return Optional.of(demand);
    }

    public synchronized Optional<SuitabilityService> suitability() {
        if (!persistence.active()) return Optional.empty();
        if (suitability == null) suitability = new SuitabilityService(dataSource.get(), policy, allocations, runClock());
        return Optional.of(suitability);
    }

    /** The run's clock row; any failure reads as no clock, so the projections answer their unavailable refusal. */
    private DemandClock runClock() {
        return scope -> {
            try {
                return clockHolder.clock().now(scope.environmentId(), scope.runId());
            } catch (RuntimeException e) {
                return Optional.empty();
            }
        };
    }
}
