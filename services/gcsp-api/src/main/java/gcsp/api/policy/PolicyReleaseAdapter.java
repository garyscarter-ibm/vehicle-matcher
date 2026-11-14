package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.supply.PolicyReading;
import gcsp.api.supply.ReleasePolicy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;

/** The supply release policy over PolicyService: three keys at one instant and version, as RetainedPolicyFile validates. */
@ApplicationScoped
public class PolicyReleaseAdapter implements ReleasePolicy {

    static final String SIZE = "supply.release.size";
    static final String LEAD = "supply.leadTimeDays";
    static final String MAX_AGE = "supply.stockSource.maxAgeMinutes";

    private final PolicyService policy;

    @Inject
    public PolicyReleaseAdapter(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public PolicyReading read(String runId, Instant asOf) {
        if (runId == null || runId.isBlank() || asOf == null) {
            return unavailable();
        }
        try {
            PolicyRead read = new PolicyRead(runId, PolicyClock.iso(asOf), null);
            PolicyResult size = policy.getAssumption(SIZE, read);
            PolicyResult lead = policy.getAssumption(LEAD, read);
            PolicyResult age = policy.getAssumption(MAX_AGE, read);
            if (!size.ok() || !lead.ok() || !age.ok() || size.policyVersion() == null
                    || !size.policyVersion().equals(lead.policyVersion())
                    || !size.policyVersion().equals(age.policyVersion())) {
                return unavailable();
            }
            Integer releaseSize = integer(size, null);
            Integer leadDays = integer(lead, null);
            Integer maxAge = integer(age, "minutes");
            if (releaseSize == null || releaseSize <= 0 || leadDays == null || leadDays < 0 || maxAge == null
                    || maxAge <= 0) {
                return unavailable();
            }
            return new PolicyReading.Ok(size.policyVersion(), releaseSize, leadDays, maxAge);
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    private static Integer integer(PolicyResult result, String unit) {
        JsonNode row = result.value();
        JsonNode value = row.path("value");
        if (!result.policyVersion().equals(row.path("policyVersion").asText(null)) || !value.isIntegralNumber()
                || !value.canConvertToInt()) {
            return null;
        }
        if (unit != null && !unit.equals(row.path("unit").asText(null))) {
            return null;
        }
        return value.asInt();
    }

    private static PolicyReading unavailable() {
        return new PolicyReading.Unavailable("The release policy is unavailable or incomplete.");
    }
}
