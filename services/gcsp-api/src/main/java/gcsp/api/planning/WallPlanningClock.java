package gcsp.api.planning;

import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Default: the policy clock with one constant version. The presenter demo clock replaces it. */
@DefaultBean
@ApplicationScoped
public class WallPlanningClock implements PlanningClock {

    @Inject
    PolicyClock clock;

    @Override
    public Observation observe(RunContext context) {
        return new Observation(clock.now(context), "wall-clock");
    }
}
