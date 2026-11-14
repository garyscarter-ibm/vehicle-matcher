package gcsp.api.brief;

import gcsp.api.persistence.RunContext;

/** Who a brief operation is for: the resolved environment, run, employee, acting principal and pinned policy. */
public record BriefScope(String environmentId, String runId, String employeeId, String principalId,
        String policyVersion) {

    RunContext runContext() {
        return new RunContext(environmentId, runId, "employee:" + employeeId);
    }
}
