package gcsp.api.production;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.time.Instant;
import java.util.Optional;

/** Default ports: the plan port reads Greg's real order plan, and the clock reads the presenter tick when persistence is on. */
@ApplicationScoped
public class ProductionWiring {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private ProductionClock tick;

    @Inject
    PolicyService policy;

    @Inject
    PlanningDemand demand;

    @Inject
    PlanningSupply supply;

    @Inject
    PlanningClock planningClock;

    /** The real plan port; a test alternative still overrides it. Unbound planner inputs answer with the planner's own code. */
    @Produces
    @DefaultBean
    @Singleton
    PlanSnapshotPort plan() {
        return new PlanningPlanSnapshot(policy, demand, supply, planningClock);
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
