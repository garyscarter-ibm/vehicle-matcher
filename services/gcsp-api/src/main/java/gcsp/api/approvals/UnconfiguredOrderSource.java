package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;

/** Default order source: no selection handoff is connected, so every call is unavailable. */
public final class UnconfiguredOrderSource implements OrderSourcePort {

    static final String CODE = "order-source-not-configured";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public Found find(RunContext ctx, String orderUuid) {
        return new Unavailable(CODE);
    }

    @Override
    public Listing list(RunContext ctx, String after, int limit) {
        return new Unavailable(CODE);
    }
}
