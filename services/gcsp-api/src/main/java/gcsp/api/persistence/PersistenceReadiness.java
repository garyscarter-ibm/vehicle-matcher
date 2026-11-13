package gcsp.api.persistence;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/** Persistence readiness: not-configured when no database is set, otherwise the claimed environment and run. */
@Readiness
@ApplicationScoped
public class PersistenceReadiness implements HealthCheck {

    @Inject
    Persistence persistence;

    @Override
    public HealthCheckResponse call() {
        HealthCheckResponseBuilder b = HealthCheckResponse.named("persistence");
        if (!persistence.active()) return b.up().withData("state", "not-configured").build();
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            return b.up().withData("state", "ready").withData("environmentId", run.environmentId())
                    .withData("runId", run.runId()).withData("revision", run.revision()).build();
        } catch (RuntimeException e) {
            return b.down().withData("state", "unavailable").build();
        }
    }
}
