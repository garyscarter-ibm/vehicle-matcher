package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.time.Instant;

/** Return rules read through the canonical PolicyService and validated by the shared rules; no defaults. */
public final class PolicyServiceReturnPolicy implements ReturnPolicyPort {

    private final PolicyService policy;
    private final String configuredVersion;

    /** configuredVersion is gcsp.environment.policy-version; blank or null falls back to the active version. */
    public PolicyServiceReturnPolicy(PolicyService policy, String configuredVersion) {
        this.policy = policy;
        this.configuredVersion = configuredVersion == null || configuredVersion.isBlank() ? null : configuredVersion.trim();
    }

    @Override
    public ReturnPolicyReading read(String runId, Instant asOf, String policyVersion) {
        if (asOf == null || runId == null || policyVersion == null || policyVersion.isEmpty()) {
            return ReturnPolicyReading.unavailable();
        }
        try {
            PolicyRead read = new PolicyRead(runId, PolicyClock.iso(asOf), policyVersion);
            ReturnPolicy built = RetainedReturnPolicy.build(policyVersion, asOf, key -> {
                PolicyResult found = policy.getAssumption(key, read);
                JsonNode row = found.value();
                return found.ok() && policyVersion.equals(found.policyVersion()) && row != null && row.isObject() ? row : null;
            });
            return built == null ? ReturnPolicyReading.unavailable() : new ReturnPolicyReading.Ok(built);
        } catch (RuntimeException e) {
            return ReturnPolicyReading.unavailable();
        }
    }

    @Override
    public String currentVersion(String runId) {
        if (configuredVersion != null) return configuredVersion;
        try {
            PolicyResult active = policy.getActiveVersion(new PolicyRead(runId, PolicyClock.iso(Instant.now()), null));
            JsonNode v = active.ok() && active.value() != null ? active.value().path("policyVersion") : null;
            return v != null && v.isTextual() && ReturnJson.text(v.textValue(), 128) ? v.textValue() : null;
        } catch (RuntimeException e) {
            return null;
        }
    }
}
