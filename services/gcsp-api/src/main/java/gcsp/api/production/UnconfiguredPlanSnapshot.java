package gcsp.api.production;

import gcsp.api.persistence.RunContext;

/** Default plan port: Greg's order plan is not bound yet, so submission is unavailable. */
public final class UnconfiguredPlanSnapshot implements PlanSnapshotPort {

    static final String CODE = "plan-not-configured";
    static final String REASON = "Greg's order plan is not connected to Production requests yet.";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public Reading current(RunContext ctx) {
        return new Unavailable(CODE, REASON);
    }
}
