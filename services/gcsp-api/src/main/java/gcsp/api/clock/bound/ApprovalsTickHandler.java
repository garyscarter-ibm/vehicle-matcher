package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.approvals.ApprovalResult;
import gcsp.api.approvals.ApprovalSelection;
import gcsp.api.approvals.ApprovalService;
import gcsp.api.approvals.ApprovalServiceHolder;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Advances order approvals on the pending-reconciliation stage; registered only with a provider and an order source. */
@ApplicationScoped
public class ApprovalsTickHandler implements TickHandler {

    public static final String ID = "lifecycle-approvals";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    ApprovalServiceHolder holder;

    @Inject
    ApprovalSelection selection;

    @Inject
    OrderSourcePort orders;

    @Override
    public String handlerId() {
        return ID;
    }

    @Override
    public String stage() {
        return STAGE;
    }

    @Override
    public boolean enabled() {
        // Without an order source every tick would be refused, so the stage stays a missing stage instead.
        return !ApprovalSelection.NONE.equals(selection.provider()) && !"none".equals(orders.mode())
                && holder.service().isPresent();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        if (request.startup()) return StartupSkip.OUTCOME;
        ApprovalService service = holder.service().orElse(null);
        if (service == null) return new HandlerOutcome.Failed("unavailable", "approvals-unavailable", true);
        return map(service.tick(request.scope(),
                new ApprovalService.TickInput(request.tickId(), request.now(), request.clockVersion())));
    }

    static HandlerOutcome map(ApprovalResult result) {
        if (result instanceof ApprovalResult.Ok ok) {
            JsonNode value = ok.value();
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof ApprovalResult.Uncertain u) {
            return new HandlerOutcome.Pending(u.operationId(), "approval", "uncertain");
        }
        if (result instanceof ApprovalResult.Conflict c && "stale-run".equals(c.code())) {
            return new HandlerOutcome.Failed("stale-run", "stale-run", false);
        }
        String status = switch (result) {
            case ApprovalResult.Conflict c -> "conflict";
            case ApprovalResult.Unavailable u -> "unavailable";
            case ApprovalResult.Invalid i -> "invalid";
            case ApprovalResult.Forbidden f -> "forbidden";
            case ApprovalResult.NotFound n -> "not-found";
            default -> "unavailable";
        };
        return new HandlerOutcome.Failed(status, result.code() == null ? "approvals-failed" : result.code(),
                result.retryable());
    }
}
