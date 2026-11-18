package gcsp.api.planning;

import gcsp.api.persistence.RunContext;

/** One planning read: the trusted run, the pinned instant and policy version, and the planning horizon end. */
public record PlanningRead(RunContext context, String asOf, String policyVersion, String horizonEnd) {

    public String runId() {
        return context.runId();
    }
}
