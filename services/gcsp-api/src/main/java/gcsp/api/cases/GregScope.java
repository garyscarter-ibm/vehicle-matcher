package gcsp.api.cases;

import gcsp.api.persistence.RunContext;

/** The scheme team (Greg or the presenter) acting on every case of the run; the HTTP layer checks the role. */
public record GregScope(String environmentId, String runId, String principalId, String policyVersion) {

    RunContext runContext() {
        return new RunContext(environmentId, runId, "greg:" + principalId);
    }
}
