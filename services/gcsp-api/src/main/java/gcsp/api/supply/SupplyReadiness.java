package gcsp.api.supply;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/** Always ready: an unconfigured source or policy is a truthful state. A database failure is the only DOWN. */
@Readiness
@ApplicationScoped
public class SupplyReadiness implements HealthCheck {

    @Inject
    SupplySelection selection;

    @Inject
    SupplyRelease supply;

    @Override
    public HealthCheckResponse call() {
        HealthCheckResponseBuilder b = HealthCheckResponse.named("supply-release")
                .withData("provider", selection.provider().mode()).withData("policy", selection.policyMode());
        if (!supply.available()) return b.up().build();
        try {
            RunContext scope = supply.scope();
            b.withData("pendingTicks", supply.pendingTicks(scope));
            supply.stock().latest(scope).ifPresent(r -> b.withData("latestTrancheId", r.trancheId()));
            return b.up().build();
        } catch (Exception e) {
            return b.down().withData("state", "unavailable").build();
        }
    }
}
