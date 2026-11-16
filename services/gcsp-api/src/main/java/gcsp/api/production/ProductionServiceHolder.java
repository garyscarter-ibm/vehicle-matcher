package gcsp.api.production;

import gcsp.api.persistence.Persistence;
import gcsp.api.supply.SupplyRelease;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ProductionService lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class ProductionServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ProductionSelection selection;

    @Inject
    PlanSnapshotPort plans;

    @Inject
    ProductionClock clock;

    @Inject
    SupplyRelease supply;

    private ProductionProviderPort provider;
    private ProductionService service;

    /** The selected provider; synthetic without persistence has nowhere to store orders, so it is unavailable. */
    public synchronized ProductionProviderPort provider() {
        if (provider == null) {
            provider = ProductionSelection.provider(selection.providerName(), () -> {
                if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
                return dataSource.get();
            });
        }
        return provider;
    }

    public ProductionClock clock() {
        return clock;
    }

    public synchronized Optional<ProductionService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            AgroalDataSource ds = dataSource.get();
            service = new ProductionService(ds, provider(), plans, clock, new StockReleaseSupplyQueue(supply.release()));
        }
        return Optional.of(service);
    }
}
