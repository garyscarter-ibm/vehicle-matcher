package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.inject.Vetoed;

/** The arm's policy view: the inner service's reads, allowances scaled (Node scaledPolicy) and reads pinned to one run id. */
@Vetoed
final class ReplayPolicy extends PolicyService {

    private final PolicyService inner;
    private final double multiplier;
    private final String runId;

    private ReplayPolicy(PolicyService inner, double multiplier, String runId) {
        super(null);
        this.inner = inner;
        this.multiplier = multiplier;
        this.runId = runId;
    }

    /** A null runId leaves each read's own run id (the scratch run); a database policy source needs a real one. */
    static PolicyService of(PolicyService inner, double multiplier, String runId) {
        return multiplier == 1 && runId == null ? inner : new ReplayPolicy(inner, multiplier, runId);
    }

    private PolicyRead pin(PolicyRead read) {
        return runId == null || read == null ? read : new PolicyRead(runId, read.asOf(), read.policyVersion());
    }

    private PolicyContext pin(PolicyContext context) {
        return runId == null || context == null ? context
                : new PolicyContext(context.runId() == null ? null : runId, context.companyId(), context.schemeId(), context.gradeId());
    }

    @Override
    public PolicyResult getPolicySnapshot(PolicyRead read) {
        return inner.getPolicySnapshot(pin(read));
    }

    @Override
    public PolicyResult getActiveVersion(PolicyRead read) {
        return inner.getActiveVersion(pin(read));
    }

    @Override
    public PolicyResult getAssumption(String key, PolicyRead read) {
        return inner.getAssumption(key, pin(read));
    }

    @Override
    public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
        PolicyResult result = inner.getAllowance(pin(context), pin(read));
        if (!result.ok() || multiplier == 1) return result;
        ObjectNode body = result.body().deepCopy();
        JsonNode value = body.get("value");
        ((ObjectNode) value).set("monthlyPoints", ReplayRecords.number(value.get("monthlyPoints").doubleValue() * multiplier));
        return new PolicyResult(result.status(), result.policyVersion(), body);
    }

    @Override
    public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
        return inner.getPointsCost(pin(context), car, pin(read));
    }

    @Override
    public PolicyResult getEligibility(PolicyContext context, JsonNode car, PolicyRead read) {
        return inner.getEligibility(pin(context), car, pin(read));
    }
}
