package gcsp.api.cases;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import java.util.Optional;

/** Builds the one CaseService lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class CaseServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    CasePolicyPort policy;

    @Inject
    CaseAccountPort account;

    @Inject
    CaseNotificationPort notifications;

    @Inject
    CaseCarSuitabilityPort suitability;

    @Inject
    RunClockHolder clock;

    private CaseService service;

    public synchronized Optional<CaseService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            service = new CaseService(dataSource.get(), policy, account, notifications, suitability, runClock());
        }
        return Optional.of(service);
    }

    /** Case time is the run clock; empty without persistence, a run clock row or a readable clock. */
    private Optional<java.time.Instant> readClock(String environmentId, String runId) {
        if (!clock.available()) return Optional.empty();
        try {
            return clock.clock().now(environmentId, runId).map(ClockReading::now);
        } catch (ClockUnavailableException e) {
            return Optional.empty();
        }
    }

    private CaseClock runClock() {
        return this::readClock;
    }
}
