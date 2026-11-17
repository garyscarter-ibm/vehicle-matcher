package gcsp.api.clock.bound;

import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.production.ProductionResult;
import gcsp.api.production.ProductionSelection;
import gcsp.api.production.ProductionService;
import gcsp.api.production.ProductionServiceHolder;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Reconciles open Production requests on a tick; startup is ProductionStartup's, as for approvals. */
@ApplicationScoped
public class ProductionTickHandler implements TickHandler {

    public static final String ID = "production-reconciliation";
    public static final String STAGE = "pending-reconciliation";
    static final String ACTOR = "system:clock";
    static final int LIMIT = 100;

    @Inject
    Persistence persistence;

    @Inject
    ProductionSelection selection;

    @Inject
    ProductionServiceHolder holder;

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
        return persistence.active() && !ProductionSelection.NONE.equals(selection.providerName());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        if (request.startup()) return StartupSkip.OUTCOME;
        try {
            ProductionService service = holder.service().orElse(null);
            if (service == null) return new HandlerOutcome.Failed("unavailable", "production-unavailable", true);
            RunContext scope = new RunContext(request.scope().environmentId(), request.scope().runId(), ACTOR);
            return map(service.reconcile(scope, LIMIT));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "production-unavailable", true);
        }
    }

    static HandlerOutcome map(ProductionResult result) {
        return switch (result) {
            case ProductionResult.Ok ok -> new HandlerOutcome.Ok(ok.value());
            case ProductionResult.Pending p -> new HandlerOutcome.Failed("unavailable", "production-pending", true);
            case ProductionResult.Uncertain u -> new HandlerOutcome.Pending(u.operationId(), "production", "uncertain");
            case ProductionResult.Conflict c when "stale-run".equals(c.code()) ->
                    new HandlerOutcome.Failed("stale-run", "stale-run", false);
            case ProductionResult.Conflict c -> new HandlerOutcome.Failed("conflict", c.code(), c.retryable());
            case ProductionResult.Unavailable u -> new HandlerOutcome.Failed("unavailable", u.code(), u.retryable());
            case ProductionResult.Invalid i -> new HandlerOutcome.Failed("invalid", i.code(), false);
        };
    }
}
