package gcsp.api.policy;

import gcsp.api.account.AccountPolicyPort;
import gcsp.api.account.AccountScope;

/**
 * Serves the account view's policy rows from the canonical PolicyService. Deliberately not a bean: AccountSelection's
 * producer owns the binding, so integration changes its policy() to return new PolicyAccountAdapter(policyService).
 */
public final class PolicyAccountAdapter implements AccountPolicyPort {

    static final String MANUAL_RULES = "manual.context.v1";
    static final String SCHEME_NAMES = "scheme.displayNames.v1";

    private final PolicyService policy;

    public PolicyAccountAdapter(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public PolicyOutcome manualRules(AccountPolicyPort.PolicyRead read) {
        return outcome(policy.getAssumption(MANUAL_RULES, read(read)));
    }

    @Override
    public PolicyOutcome allowance(AccountScope scope, AccountPolicyPort.PolicyRead read) {
        gcsp.api.policy.PolicyRead policyRead = read(read);
        PolicyContext context = new PolicyContext(policyRead == null ? null : policyRead.runId(),
                scope == null ? null : scope.companyId(), scope == null ? null : scope.schemeId(),
                scope == null ? null : scope.gradeId());
        return outcome(policy.getAllowance(context, policyRead));
    }

    @Override
    public PolicyOutcome schemeDisplayNames(AccountPolicyPort.PolicyRead read) {
        return outcome(policy.getAssumption(SCHEME_NAMES, read(read)));
    }

    private static gcsp.api.policy.PolicyRead read(AccountPolicyPort.PolicyRead read) {
        return read == null ? null : new gcsp.api.policy.PolicyRead(read.runId(), read.asOf(), read.policyVersion());
    }

    private static PolicyOutcome outcome(PolicyResult result) {
        return new PolicyOutcome(result.status(), result.ok() ? null : result.code(), result.policyVersion(),
                result.ok() ? result.value() : null);
    }
}
