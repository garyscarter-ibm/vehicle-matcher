package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.AllocationTriggers;
import gcsp.api.allocation.TriggerResult;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Consumes allocation triggers in stream order on a tick; the buddy-allocation stage is not a startup stage. */
@ApplicationScoped
public class BuddyAllocationTickHandler implements TickHandler {

    public static final String ID = "buddy-allocation";
    public static final String STAGE = "buddy-allocation";
    static final int LIMIT = 100;

    @Inject
    Persistence persistence;

    @Inject
    Allocation allocation;

    @Inject
    Instance<AgroalDataSource> sources;

    @ConfigProperty(name = "gcsp.allocation.candidates.provider", defaultValue = "none")
    String candidates;

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
        // Without a candidates provider every tick would interrupt here before outbox-dispatch.
        return persistence.active() && candidates != null && !candidates.isBlank() && !"none".equalsIgnoreCase(candidates.trim());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            AllocationScope scope = new AllocationScope(request.scope().environmentId(), request.scope().runId(),
                    request.policyVersion(), request.now(), request.clockVersion());
            return map(new AllocationTriggers(sources.get(), allocation.service()).consume(scope, LIMIT));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-allocation-unavailable", true);
        }
    }

    static HandlerOutcome map(TriggerResult result) {
        if (result instanceof TriggerResult.Consumed c) {
            ObjectNode value = JsonNodeFactory.instance.objectNode();
            value.put("allocated", c.allocations().size()).put("cursorRevision", c.cursorRevision())
                    .put("cursorEventId", c.cursorEventId());
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof TriggerResult.Pending p) {
            if ("stale-run".equals(p.code())) return new HandlerOutcome.Failed("stale-run", "stale-run", false);
            return new HandlerOutcome.Failed("unavailable", p.code(), p.retryable());
        }
        TriggerResult.Refused r = (TriggerResult.Refused) result;
        String status = r.code().startsWith("invalid") || r.code().endsWith("-invalid") ? "invalid" : "conflict";
        return new HandlerOutcome.Failed(status, r.code(), false);
    }
}
