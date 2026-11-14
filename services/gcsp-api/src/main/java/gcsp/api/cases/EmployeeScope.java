package gcsp.api.cases;

import gcsp.api.persistence.RunContext;

/** An employee acting on their own cases: resolved environment, run, employee, principal and pinned policy. */
public record EmployeeScope(String environmentId, String runId, String employeeId, String principalId,
        String policyVersion) {

    RunContext runContext() {
        return new RunContext(environmentId, runId, "employee:" + employeeId);
    }
}
