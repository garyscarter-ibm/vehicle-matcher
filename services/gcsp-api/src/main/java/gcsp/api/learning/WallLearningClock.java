package gcsp.api.learning;

import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Default clock: the policy wall clock as ISO millis, versioned wall-clock. */
@DefaultBean
@ApplicationScoped
public class WallLearningClock implements LearningClock {

    public static final String VERSION = "wall-clock";

    private final PolicyClock clock;

    @Inject
    public WallLearningClock(PolicyClock clock) {
        this.clock = clock;
    }

    @Override
    public Reading now(RunContext context) {
        return new Reading(PolicyClock.iso(clock.now(context)), VERSION);
    }
}
