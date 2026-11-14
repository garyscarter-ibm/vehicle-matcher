package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Approval assumptions from the canonical PolicyService at the order's pinned version; built by ApprovalDefaults. */
public final class PolicyApprovalAdapter implements ApprovalPolicyPort {

    private static final String SOURCE_DOWN = "policy-source-unavailable";

    private final PolicyService policy;
    private final PolicyClock clock;
    private final String environmentId;
    private final String runId;

    public PolicyApprovalAdapter(PolicyService policy, PolicyClock clock, String environmentId, String runId) {
        this.policy = policy;
        this.clock = clock;
        this.environmentId = environmentId == null ? "" : environmentId;
        this.runId = runId == null ? "" : runId;
    }

    @Override
    public Read entries(String policyVersion, List<String> keys) {
        if (runId.isBlank() || policyVersion == null || policyVersion.isBlank()) return new Unavailable(SOURCE_DOWN);
        try {
            String asOf = PolicyClock.iso(clock.now(new RunContext(environmentId, runId, "approvals-policy")));
            Map<String, JsonNode> found = new LinkedHashMap<>();
            for (String key : keys) {
                PolicyResult r = policy.getAssumption(key, new PolicyRead(runId, asOf, policyVersion));
                JsonNode row = r.value();
                if (r.ok()) {
                    if (row == null || !row.isObject() || !policyVersion.equals(r.policyVersion())) {
                        return new Unavailable(SOURCE_DOWN);
                    }
                    found.put(key, row);
                } else if ("not-found".equals(r.status()) && "policy-version-not-found".equals(r.code())) {
                    return new VersionNotFound();
                } else if ("invalid".equals(r.status()) && "unknown-assumption".equals(r.code())) {
                    continue;
                } else {
                    return new Unavailable(r.code() == null ? SOURCE_DOWN : r.code());
                }
            }
            return new Found(policyVersion, found);
        } catch (RuntimeException e) {
            return new Unavailable(SOURCE_DOWN);
        }
    }
}
