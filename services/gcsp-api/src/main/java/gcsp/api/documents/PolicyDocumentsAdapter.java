package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Document assumptions from the canonical PolicyService for the configured run; any failure is empty, never a default. */
@ApplicationScoped
public class PolicyDocumentsAdapter implements DocumentPolicyPort {

    private final PolicyService policy;
    private final PolicyClock clock;
    private final String environmentId;
    private final String runId;

    @Inject
    public PolicyDocumentsAdapter(PolicyService policy, PolicyClock clock,
            @ConfigProperty(name = "gcsp.environment.id") Optional<String> environmentId,
            @ConfigProperty(name = "gcsp.environment.run-id") Optional<String> runId) {
        this.policy = policy;
        this.clock = clock;
        this.environmentId = environmentId.orElse("");
        this.runId = runId.orElse("");
    }

    @Override
    public Optional<Assumption> assumption(String key, String policyVersion) {
        if (runId.isBlank() || policyVersion == null || policyVersion.isBlank()) return Optional.empty();
        try {
            String asOf = PolicyClock.iso(clock.now(new RunContext(environmentId, runId, "documents-policy")));
            PolicyResult found = policy.getAssumption(key, new PolicyRead(runId, asOf, policyVersion));
            JsonNode row = found.value();
            if (!found.ok() || row == null || !row.isObject()) return Optional.empty();
            return Optional.of(new Assumption(key, row.get("value"), text(row, "unit"), text(row, "status"),
                    text(row, "basis"), text(row, "source"), text(row, "sourceDate"), found.policyVersion()));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static String text(JsonNode row, String name) {
        JsonNode v = row.get(name);
        return v != null && v.isTextual() ? v.textValue() : null;
    }
}
