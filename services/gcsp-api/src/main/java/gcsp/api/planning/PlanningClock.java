package gcsp.api.planning;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/**
 * The instant a plan is read at and the version pinning it (Node clock.now). A read observes it twice; a different
 * version is a changed input. The instant itself may move (wall time) without being one.
 */
public interface PlanningClock {

    record Observation(Instant now, String version) {
    }

    Observation observe(RunContext context);
}
