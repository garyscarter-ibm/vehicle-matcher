package gcsp.api.clock.bound;

import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingSelection;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Reconciles open ordering handoffs on the tick, as Node's selection-order-reconciliation; startup is ordering's own. */
@ApplicationScoped
public class SelectionOrderTickHandler implements TickHandler {

    public static final String ID = "selection-order-reconciliation";
    public static final String STAGE = "pending-reconciliation";
    static final int LIMIT = 100;

    @Inject
    OrderingServiceHolder holder;

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
        return !OrderingSelection.NONE.equals(holder.provider()) && holder.service().isPresent();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        if (request.startup()) return StartupSkip.OUTCOME;
        OrderingService service = holder.service().orElse(null);
        if (service == null) return new HandlerOutcome.Failed("unavailable", "ordering-unavailable", true);
        RunContext scope = request.scope();
        return map(service.reconcileOpen(new RunContext(scope.environmentId(), scope.runId(), "system:clock"), LIMIT));
    }

    static HandlerOutcome map(OrderingResult result) {
        if (result instanceof OrderingResult.Ok ok) return new HandlerOutcome.Ok(ok.value());
        if (result instanceof OrderingResult.Unavailable u) return new HandlerOutcome.Failed("unavailable", u.code(), true);
        if (result instanceof OrderingResult.Refused r) return new HandlerOutcome.Failed("invalid", r.code(), false);
        return new HandlerOutcome.Failed("unavailable", "ordering-failed", true);
    }
}
