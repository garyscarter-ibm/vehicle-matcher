package gcsp.api.production;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.time.Instant;
import java.util.Optional;

/** Default ports: FUCQ-477 binds the real plan snapshot later, and the clock reads the presenter tick when persistence is on. */
@ApplicationScoped
public class ProductionWiring {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private ProductionClock tick;

    @Produces
    @DefaultBean
    @Singleton
    PlanSnapshotPort unconfiguredPlan() {
        return new UnconfiguredPlanSnapshot();
    }

    @Produces
    @DefaultBean
    @Singleton
    ProductionClock tickClock() {
        return new ProductionClock() {
            @Override
            public Optional<Instant> now(RunContext ctx) {
                return clock().now(ctx);
            }
        };
    }

    private synchronized ProductionClock clock() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        if (tick == null) tick = new TickProductionClock(dataSource.get());
        return tick;
    }
}
