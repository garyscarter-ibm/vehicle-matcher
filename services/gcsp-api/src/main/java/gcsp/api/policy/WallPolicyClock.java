package gcsp.api.policy;

import gcsp.api.persistence.RunContext;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;

/** Default clock: the wall clock. Any other PolicyClock bean replaces it. */
@DefaultBean
@ApplicationScoped
public class WallPolicyClock implements PolicyClock {

    @Override
    public Instant now(RunContext context) {
        return Instant.now();
    }
}
