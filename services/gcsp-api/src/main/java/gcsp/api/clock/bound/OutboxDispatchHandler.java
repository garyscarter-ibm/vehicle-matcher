package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.notify.DispatchResult;
import gcsp.api.notify.Notifications;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Drains the notification outbox on the outbox-dispatch stage; registered when notifications are available. */
@ApplicationScoped
public class OutboxDispatchHandler implements TickHandler {

    public static final String ID = "captured-outbox";
    public static final String STAGE = "outbox-dispatch";

    @Inject
    Notifications notifications;

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
        return notifications.available();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        return map(notifications.dispatcher().dispatchPending());
    }

    static HandlerOutcome map(DispatchResult result) {
        if (result instanceof DispatchResult.Counts c) {
            ObjectNode value = JsonNodeFactory.instance.objectNode();
            value.put("sent", c.sent());
            value.put("retrying", c.retrying());
            value.put("failed", c.failed());
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof DispatchResult.StaleRun) return new HandlerOutcome.Failed("stale-run", "stale-run", false);
        return new HandlerOutcome.Failed("unavailable", "notifications-unavailable", true);
    }
}
