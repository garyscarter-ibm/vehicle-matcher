package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The renewalCase.* rows of the pinned version from the canonical PolicyService; all nine keys or empty. */
@ApplicationScoped
public class PolicyCaseAdapter implements CasePolicyPort {

    private final PolicyService policy;
    private final PolicyClock clock;
    private final String environmentId;
    private final String runId;

    @Inject
    public PolicyCaseAdapter(PolicyService policy, PolicyClock clock,
            @ConfigProperty(name = "gcsp.environment.id") Optional<String> environmentId,
            @ConfigProperty(name = "gcsp.environment.run-id") Optional<String> runId) {
        this.policy = policy;
        this.clock = clock;
        this.environmentId = environmentId.orElse("");
        this.runId = runId.orElse("");
    }

    @Override
    public Optional<Map<String, JsonNode>> assumptions(String policyVersion) {
        if (runId.isBlank() || policyVersion == null || policyVersion.isBlank()) return Optional.empty();
        try {
            PolicyRead read = new PolicyRead(runId,
                    PolicyClock.iso(clock.now(new RunContext(environmentId, runId, "case-policy"))), policyVersion);
            Map<String, JsonNode> rows = new LinkedHashMap<>();
            for (String key : CasePolicy.KEYS) {
                PolicyResult found = policy.getAssumption(key, read);
                if (!found.ok() || !policyVersion.equals(found.policyVersion()) || found.value() == null) {
                    return Optional.empty();
                }
                rows.put(key, found.value().deepCopy());
            }
            return Optional.of(rows);
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}
