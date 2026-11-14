package gcsp.api.brief;

import java.util.Optional;

/** Reads the pinned policy entries; called inside a command, so it must be a bounded read with no provider I/O. */
public interface BriefPolicyPort {

    /** The assumptions of exactly this policy version, or empty when the policy is not available. */
    Optional<BriefAssumptions> assumptions(String policyVersion);
}
