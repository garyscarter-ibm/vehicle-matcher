package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;

/** Live-shaped boundary: no BMW approval system is reachable, so every call is refused and the order stays put. */
public final class LiveApprovalStatusStub implements ApprovalStatusProvider {

    static final String CODE = "live-ordering-unsupported";
    static final String REASON = "Live approval updates are not connected yet. The order stays at its current step.";

    @Override
    public String mode() {
        return "live";
    }

    @Override
    public String provider() {
        return "live-ordering-status:stub";
    }

    @Override
    public Response requestDecision(RunContext ctx, Request request) {
        return Response.of(Status.UNSUPPORTED, request, CODE, REASON);
    }

    @Override
    public Response reconcile(RunContext ctx, Request request) {
        return requestDecision(ctx, request);
    }
}
