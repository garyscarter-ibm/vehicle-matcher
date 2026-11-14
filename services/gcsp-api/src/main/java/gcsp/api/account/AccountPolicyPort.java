package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;

/** Policy rows the account view needs; mirrors the PolicyService getAssumption/getAllowance outcome shape. */
public interface AccountPolicyPort {

    record PolicyRead(String runId, String asOf, String policyVersion) {}

    /** {@code value} is the whole policy row; an assumption's payload is {@code value.get("value")}. */
    record PolicyOutcome(String status, String code, String policyVersion, JsonNode value) {
        boolean isOk() {
            return "ok".equals(status);
        }
    }

    /** The assumption row for key manual.context.v1. */
    PolicyOutcome manualRules(PolicyRead read);

    PolicyOutcome allowance(AccountScope scope, PolicyRead read);

    /** The assumption row for key scheme.displayNames.v1. */
    PolicyOutcome schemeDisplayNames(PolicyRead read);
}
