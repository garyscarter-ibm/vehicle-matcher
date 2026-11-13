package gcsp.api.health;

import gcsp.api.identity.IdentityPort;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;

/** Ready once the identity port is selected; mode "none" is ready and refuses every context call. */
@Readiness
@ApplicationScoped
public class IdentityReadiness implements HealthCheck {

    @Inject
    IdentityPort identity;

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.named("identity-port").up().withData("provider", identity.mode()).build();
    }
}
