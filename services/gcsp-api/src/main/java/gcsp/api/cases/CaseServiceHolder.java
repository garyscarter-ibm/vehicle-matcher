package gcsp.api.cases;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Clock;
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

    private CaseService service;

    public synchronized Optional<CaseService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            service = new CaseService(dataSource.get(), policy, account, notifications, suitability, Clock.systemUTC());
        }
        return Optional.of(service);
    }
}
