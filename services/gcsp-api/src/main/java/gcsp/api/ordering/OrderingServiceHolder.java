package gcsp.api.ordering;

import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one OrderingService lazily over the Agroal datasource and the selected provider; empty without persistence. */
@ApplicationScoped
public class OrderingServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    OrderingSelection selection;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    private OrderingService service;

    public String provider() {
        return selection.provider();
    }

    public synchronized Optional<OrderingService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            AgroalDataSource ds = dataSource.get();
            service = new OrderingService(ds, new OrderingTerms(policy, clock),
                    OrderingProviderSelection.select(selection.provider(), ds));
        }
        return Optional.of(service);
    }
}
