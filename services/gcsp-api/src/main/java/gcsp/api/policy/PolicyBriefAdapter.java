package gcsp.api.policy;

import gcsp.api.brief.BriefAssumptions;
import gcsp.api.brief.BriefPolicyPort;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The brief's pinned assumptions from PolicyService, for the configured run (the port has none); all keys or empty. */
@ApplicationScoped
public class PolicyBriefAdapter implements BriefPolicyPort {

    private final PolicyService policy;
    private final PolicyClock clock;
    private final String environmentId;
    private final String runId;

    @Inject
    public PolicyBriefAdapter(PolicyService policy, PolicyClock clock,
            @ConfigProperty(name = "gcsp.environment.id") Optional<String> environmentId,
            @ConfigProperty(name = "gcsp.environment.run-id") Optional<String> runId) {
        this.policy = policy;
        this.clock = clock;
        this.environmentId = environmentId.orElse("");
        this.runId = runId.orElse("");
    }

    @Override
    public Optional<BriefAssumptions> assumptions(String policyVersion) {
        if (runId.isBlank() || policyVersion == null || policyVersion.isBlank()) {
            return Optional.empty();
        }
        try {
            PolicyRead read = new PolicyRead(runId,
                    PolicyClock.iso(clock.now(new RunContext(environmentId, runId, "brief-policy"))), policyVersion);
            Map<String, com.fasterxml.jackson.databind.JsonNode> entries = new LinkedHashMap<>();
            for (String key : BriefAssumptions.KEYS) {
                PolicyResult found = policy.getAssumption(key, read);
                if (!found.ok() || !policyVersion.equals(found.policyVersion())) {
                    return Optional.empty();
                }
                entries.put(key, found.value().deepCopy());
            }
            return Optional.of(new BriefAssumptions(policyVersion, entries));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}
