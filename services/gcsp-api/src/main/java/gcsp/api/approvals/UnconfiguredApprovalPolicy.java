package gcsp.api.approvals;

import java.util.List;

/** No policy file is set: every version is unknown, so each order refuses as lifecycle-policy-unavailable. */
public final class UnconfiguredApprovalPolicy implements ApprovalPolicyPort {

    @Override
    public Read entries(String policyVersion, List<String> keys) {
        return new VersionNotFound();
    }
}
