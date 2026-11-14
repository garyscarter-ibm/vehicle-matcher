package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/** Always ready: an unconfigured provider, policy or adapter is a truthful state. A database failure is the only DOWN. */
@Readiness
@ApplicationScoped
public class ReturnReadiness implements HealthCheck {

    @Inject
    ReturnService service;

    @Override
    public HealthCheckResponse call() {
        ReturnSelection selection = service.selection();
        HealthCheckResponseBuilder b = HealthCheckResponse.named("returns")
                .withData("provider", selection.providerName()).withData("policy", selection.policyMode())
                .withData("source", service.sourceMode()).withData("handover", service.handoverMode());
        if (!service.available()) return b.up().build();
        try {
            RunContext scope = service.scope(ReturnPlans.SYSTEM_ACTOR);
            b.withData("openOperations", service.openOperations(scope));
            return b.up().build();
        } catch (Exception e) {
            return b.down().withData("state", "unavailable").build();
        }
    }
}
