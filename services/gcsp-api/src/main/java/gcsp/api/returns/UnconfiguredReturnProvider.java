package gcsp.api.returns;

import java.time.Instant;
import java.util.List;

/** The default selection: no provider is usable, so every call answers unavailable and writes nothing. */
public final class UnconfiguredReturnProvider implements ReturnProviderPort {

    public static final String CODE = "return-provider-unavailable";
    static final String REASON = "No return provider is configured. Ask the scheme team to check the scheme setup.";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public Offer offerSlots(SlotPolicy slotPolicy, Instant now) {
        return new Offer(Status.UNAVAILABLE, List.of(), CODE, REASON, false);
    }

    @Override
    public Result requestSlot(Operation op) {
        return unavailable(op);
    }

    @Override
    public Result confirm(Operation op, Instant now) {
        return unavailable(op);
    }

    @Override
    public Result acceptProposal(Operation op) {
        return unavailable(op);
    }

    @Override
    public Result confirmOutcome(Operation op, Instant now) {
        return unavailable(op);
    }

    @Override
    public Result reconcile(Operation op) {
        return unavailable(op);
    }

    private static Result unavailable(Operation op) {
        return new Result(Status.UNAVAILABLE, op == null ? null : op.operationId(), op == null ? null : op.orderUuid(),
                op == null ? null : op.step(), null, null, null, null, null, CODE, REASON, false);
    }
}
