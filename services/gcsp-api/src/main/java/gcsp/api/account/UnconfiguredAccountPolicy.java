package gcsp.api.account;

/** Honest refusal until the PolicyService adapter replaces it at integration (FUCQ-457). */
final class UnconfiguredAccountPolicy implements AccountPolicyPort {

    private static final PolicyOutcome REFUSED = new PolicyOutcome("unavailable", "policy-not-configured", null, null);

    @Override
    public PolicyOutcome manualRules(PolicyRead read) {
        return REFUSED;
    }

    @Override
    public PolicyOutcome allowance(AccountScope scope, PolicyRead read) {
        return REFUSED;
    }

    @Override
    public PolicyOutcome schemeDisplayNames(PolicyRead read) {
        return REFUSED;
    }
}
