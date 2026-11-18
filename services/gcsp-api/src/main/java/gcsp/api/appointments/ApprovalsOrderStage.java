package gcsp.api.appointments;

import gcsp.api.approvals.ApprovalResult;
import gcsp.api.approvals.ApprovalService;
import gcsp.api.approvals.ApprovalServiceHolder;
import gcsp.api.auth.Role;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;

/** The lifecycle stage reader over the approvals service, read as the system so every order is visible (Node stagePort). */
@ApplicationScoped
public class ApprovalsOrderStage implements OrderStagePort {

    private static final ApprovalService.Reader SYSTEM = new ApprovalService.Reader(Role.PRESENTER, null);

    @Inject
    ApprovalServiceHolder approvals;

    @Override
    public StageRead read(RunContext context, String orderUuid) {
        try {
            Optional<ApprovalService> service = approvals.service();
            if (service.isEmpty()) return new StageRead.Unavailable("unavailable", "approvals-unavailable");
            return map(service.get().read(context, SYSTEM, orderUuid));
        } catch (RuntimeException e) {
            return new StageRead.Unavailable("unavailable", "approvals-unavailable");
        }
    }

    /** One approvals answer as a stage read; anything that is not a readable order is unavailable with its status. */
    static StageRead map(ApprovalResult result) {
        return switch (result) {
            case ApprovalResult.Ok ok -> new StageRead.Ok(ok.value());
            case ApprovalResult.NotFound n -> new StageRead.NotFound();
            case ApprovalResult.Forbidden f -> new StageRead.Forbidden();
            case ApprovalResult.Unavailable u -> new StageRead.Unavailable("unavailable", u.code());
            case ApprovalResult.Invalid i -> new StageRead.Unavailable("invalid", i.code());
            case ApprovalResult.Conflict c -> new StageRead.Unavailable("conflict", c.code());
            case ApprovalResult.Uncertain u -> new StageRead.Unavailable("uncertain", u.code());
        };
    }
}
