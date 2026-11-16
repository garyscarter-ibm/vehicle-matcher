package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.offers.OfferDecisions;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** Drives open remote offer decisions on every tick, startup included: that is the restart path. */
@ApplicationScoped
public class OfferDecisionTickHandler implements TickHandler {

    public static final String ID = "offer-decision-reconciliation";
    public static final String STAGE = "pending-reconciliation";
    static final int LIMIT = 100;

    @Inject
    Persistence persistence;

    @Inject
    Instance<RemoteBuddy> remote;

    @Inject
    OfferDecisions decisions;

    private BooleanSupplier active;
    private Supplier<RemoteBuddy> buddy;
    private Supplier<OfferDecisions> service;

    public OfferDecisionTickHandler() {}

    public OfferDecisionTickHandler(BooleanSupplier active, Supplier<RemoteBuddy> buddy, Supplier<OfferDecisions> service) {
        this.active = active;
        this.buddy = buddy;
        this.service = service;
    }

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
        boolean on = active != null ? active.getAsBoolean() : persistence.active();
        return on && "remote".equals(buddy().get().mode());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        RunContext scope = request.scope();
        try {
            OfferDecisions offers = service != null ? service.get() : decisions;
            return map(offers.reconcileRemote(scope.environmentId(), scope.runId(), LIMIT));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "offer-decisions-unavailable", true);
        }
    }

    private Supplier<RemoteBuddy> buddy() {
        return buddy != null ? buddy : remote::get;
    }

    static HandlerOutcome map(ReconcileResult r) {
        ObjectNode counts = JsonNodeFactory.instance.objectNode();
        counts.put("driven", r.driven()).put("settled", r.settled()).put("pending", r.pending())
                .put("refused", r.refused());
        return new HandlerOutcome.Ok(counts);
    }
}
