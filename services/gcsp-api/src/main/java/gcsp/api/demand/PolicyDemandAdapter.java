package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Demand policy from the canonical PolicyService for the configured run; a missing key stays null so reads fail closed. */
@ApplicationScoped
public class PolicyDemandAdapter implements DemandPolicyPort {

    static final String THRESHOLD = "greg.demand.smallCountThreshold";
    static final String DECLINE_REASONS = "offer.declineReasons.v1";
    static final String DECLINED_CAR = "offer.declinedCar.exclusion";
    static final String RECOMMENDATION = "employee.recommendation.v1";
    static final String TIE_BREAK = "allocation.tieBreak.rule";

    private final PolicyService policy;
    private final String runId;

    @Inject
    public PolicyDemandAdapter(PolicyService policy, @ConfigProperty(name = "gcsp.environment.run-id") Optional<String> runId) {
        this.policy = policy;
        this.runId = runId.orElse("");
    }

    @Override
    public Optional<DemandPolicy> read(String policyVersion, Instant asOf) {
        if (runId.isBlank() || policyVersion == null || policyVersion.isBlank() || asOf == null) return Optional.empty();
        try {
            PolicyRead read = new PolicyRead(runId, PolicyClock.ISO_MILLIS.format(asOf), policyVersion);
            JsonNode threshold = row(THRESHOLD, read, policyVersion);
            JsonNode recommendation = value(row(RECOMMENDATION, read, policyVersion));
            return Optional.of(new DemandPolicy(policyVersion, value(threshold),
                    threshold != null && threshold.path("status").isTextual() ? threshold.get("status").asText() : null,
                    value(row(DECLINE_REASONS, read, policyVersion)), value(row(DECLINED_CAR, read, policyVersion)),
                    recommendation == null ? null : recommendation.get("essentials"), value(row(TIE_BREAK, read, policyVersion))));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    /** The assumption row of exactly this version, or null. */
    private JsonNode row(String key, PolicyRead read, String version) {
        PolicyResult found = policy.getAssumption(key, read);
        return found.ok() && version.equals(found.policyVersion()) && found.value() != null ? found.value().deepCopy() : null;
    }

    private static JsonNode value(JsonNode row) {
        return row == null ? null : row.get("value");
    }
}
