package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.returns.ReturnPlans;
import gcsp.api.returns.ReturnSelection;
import gcsp.api.returns.ReturnService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Progresses return outcomes at the tick's time, retrying provider writes; registered when a provider is configured. */
@ApplicationScoped
public class ReturnOutcomesTickHandler implements TickHandler {

    public static final String ID = "lifecycle-return-outcomes";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    ReturnService returns;

    @Inject
    ReturnSelection selection;

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
        return returns.available() && !ReturnSelection.NONE.equals(selection.providerName());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        if (request.startup()) return StartupSkip.OUTCOME;
        return map(returns.plans().progress(request.scope(), request.now(), true));
    }

    static HandlerOutcome map(ReturnPlans.Summary s) {
        ObjectNode value = JsonNodeFactory.instance.objectNode();
        value.put("orders", s.orders()).put("applied", s.applied()).put("waiting", s.waiting())
                .put("blocked", s.blocked()).put("uncertain", s.uncertain()).put("idle", s.idle());
        ArrayNode failed = value.putArray("failed");
        s.failed().forEach(f -> {
            ObjectNode one = failed.addObject();
            if (f.orderUuid() == null) one.putNull("orderUuid"); else one.put("orderUuid", f.orderUuid());
            one.put("code", f.code());
        });
        return new HandlerOutcome.Ok(value);
    }
}
