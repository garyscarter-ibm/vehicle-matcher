package gcsp.api.ordering;

import gcsp.api.persistence.RunContext;

/** Who is ordering what: the run, the employee's own entitlement slot and the policy version pinned to the run. */
public record OrderingScope(String environmentId, String runId, String employeeId, String entitlementSlotId,
        String policyVersion) {

    /** The receipt scope: the employee is the actor. */
    public RunContext context() {
        return new RunContext(environmentId, runId, employeeId);
    }
}
