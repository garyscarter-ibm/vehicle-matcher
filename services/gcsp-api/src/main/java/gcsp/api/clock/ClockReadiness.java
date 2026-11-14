package gcsp.api.clock;

import gcsp.api.persistence.EnvironmentGuard;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/** Always ready: the startup pass result and bound handlers are reported, and only a database failure is DOWN. */
@Readiness
@ApplicationScoped
public class ClockReadiness implements HealthCheck {

    @Inject
    RunClockHolder holder;

    @Override
    public HealthCheckResponse call() {
        HealthCheckResponseBuilder b = HealthCheckResponse.named("clock").withData("startup", holder.summary());
        if (!holder.available()) return b.up().build();
        try {
            List<String> ids = holder.handlerIds();
            b.withData("handlers", String.join(",", ids));
            EnvironmentGuard.RunState run = holder.activeRun();
            b.withData("initialized", holder.clock().now(run.environmentId(), run.runId()).isPresent());
            return b.up().build();
        } catch (RuntimeException e) {
            return b.down().withData("state", "unavailable").build();
        }
    }
}
