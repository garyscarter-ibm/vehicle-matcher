package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;

/** Default status provider (mode none): no approval system is selected, so every call is unavailable. */
public final class UnconfiguredApprovalStatus implements ApprovalStatusProvider {

    static final String CODE = "approval-provider-not-configured";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public String provider() {
        return "none";
    }

    @Override
    public Response requestDecision(RunContext ctx, Request request) {
        return Response.of(Status.UNAVAILABLE, request, CODE, "No approval system is connected.");
    }

    @Override
    public Response reconcile(RunContext ctx, Request request) {
        return requestDecision(ctx, request);
    }
}
