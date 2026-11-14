package gcsp.api.claims;

import gcsp.api.persistence.RunContext;

/** Who is acting: the run, the acting principal, the employee whose claim it is and the policy version they hold. */
public record ClaimScope(String environmentId, String runId, String actorId, String employeeId, String policyVersion) {

    public RunContext context() {
        return new RunContext(environmentId, runId, actorId);
    }
}
