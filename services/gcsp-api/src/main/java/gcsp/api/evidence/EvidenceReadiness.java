package gcsp.api.evidence;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.HealthCheckResponseBuilder;
import org.eclipse.microprofile.health.Readiness;

/** UP for provider none or an active corpus; a configured provider with no corpus is DOWN (liveness is unaffected). */
@Readiness
@ApplicationScoped
public class EvidenceReadiness implements HealthCheck {

    @Inject
    EvidenceSelection selection;

    @Override
    public HealthCheckResponse call() {
        EvidenceSelection.Selected s = selection.selected();
        HealthCheckResponseBuilder b = HealthCheckResponse.named("vehicle-evidence").withData("provider", s.provider());
        if (s.load() == null) return b.up().build();
        ActiveInfo active = s.load().active();
        if (active == null) {
            return b.down().withData("state", "unavailable")
                    .withData("code", s.load().failure() == null ? "corpus-absent" : s.load().failure().code()).build();
        }
        return b.up().withData("datasetId", active.datasetId()).withData("version", active.version())
                .withData("manifestDigest", active.manifestDigest()).withData("recovered", s.load().recovered())
                .withData("catalogue", s.catalogue().available() ? "available" : "unavailable")
                .withData("definitions", s.definitions().available() ? "available" : "unavailable").build();
    }
}
