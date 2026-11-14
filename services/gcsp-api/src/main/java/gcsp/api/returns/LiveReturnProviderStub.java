package gcsp.api.returns;

import java.time.Instant;
import java.util.List;

/** Live-shaped boundary: no retailer calendar or return confirmation is reachable, so every call is refused and nothing is written. */
public final class LiveReturnProviderStub implements ReturnProviderPort {

    public static final String OUTCOMES_CODE = "live-return-outcomes-unsupported";
    public static final String APPOINTMENTS_CODE = "live-appointments-unsupported";

    @Override
    public String mode() {
        return "live";
    }

    @Override
    public Offer offerSlots(SlotPolicy slotPolicy, Instant now) {
        return new Offer(Status.UNSUPPORTED, List.of(), APPOINTMENTS_CODE, appointmentsReason(), false);
    }

    @Override
    public Result requestSlot(Operation op) {
        return refuse(op, APPOINTMENTS_CODE, appointmentsReason());
    }

    @Override
    public Result confirm(Operation op, Instant now) {
        return refuse(op, APPOINTMENTS_CODE, appointmentsReason());
    }

    @Override
    public Result acceptProposal(Operation op) {
        return refuse(op, APPOINTMENTS_CODE, appointmentsReason());
    }

    @Override
    public Result confirmOutcome(Operation op, Instant now) {
        return refuse(op, OUTCOMES_CODE, outcomesReason());
    }

    @Override
    public Result reconcile(Operation op) {
        boolean outcome = op != null && STEP_OUTCOME.equals(op.step());
        return refuse(op, outcome ? OUTCOMES_CODE : APPOINTMENTS_CODE, outcome ? outcomesReason() : appointmentsReason());
    }

    private static String appointmentsReason() {
        return "Live appointment booking is not connected yet. The appointment stays as it is.";
    }

    private static String outcomesReason() {
        return "Live return confirmation is not connected yet. The return stays as it is.";
    }

    private static Result refuse(Operation op, String code, String reason) {
        return new Result(Status.UNSUPPORTED, op == null ? null : op.operationId(), op == null ? null : op.orderUuid(),
                op == null ? null : op.step(), null, null, null, null, null, code, reason, false);
    }
}
