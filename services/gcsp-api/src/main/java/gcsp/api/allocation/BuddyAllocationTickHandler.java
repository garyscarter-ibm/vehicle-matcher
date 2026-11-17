package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Allocates Buddy offers from unconsumed stock-release, brief, expiry and decline triggers on each tick. */
@ApplicationScoped
public class BuddyAllocationTickHandler implements TickHandler {

    public static final String ID = "buddy-allocation";
    public static final String STAGE = "buddy-allocation";
    static final int LIMIT = 200;

    @Inject
    Persistence persistence;

    @Inject
    Allocation allocation;

    @ConfigProperty(name = BuddyTickSupport.CANDIDATES_KEY, defaultValue = "none")
    String provider;

    private BooleanSupplier active;
    private Supplier<String> candidates;
    private Supplier<AllocationTriggers> triggers;

    public BuddyAllocationTickHandler() {}

    public BuddyAllocationTickHandler(BooleanSupplier active, Supplier<String> candidates,
            Supplier<AllocationTriggers> triggers) {
        this.active = active;
        this.candidates = candidates;
        this.triggers = triggers;
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
        return on && BuddyTickSupport.candidatesConfigured(candidates != null ? candidates.get() : provider);
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            AllocationTriggers consumer = triggers != null ? triggers.get() : allocation.triggers();
            return map(consumer.consume(BuddyTickSupport.scope(request), LIMIT));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-allocation-unavailable", true);
        }
    }

    static HandlerOutcome map(TriggerResult result) {
        if (result instanceof TriggerResult.Consumed done) {
            Map<String, Integer> states = new TreeMap<>();
            for (TriggerResult.Item item : done.allocations()) states.merge(item.state(), 1, Integer::sum);
            ObjectNode value = BuddyTickSupport.counts();
            value.put("allocations", done.allocations().size()).put("cursorRevision", done.cursorRevision());
            ObjectNode byState = value.putObject("states");
            states.forEach(byState::put);
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof TriggerResult.Pending p) return new HandlerOutcome.Failed("unavailable", p.code(), p.retryable());
        TriggerResult.Refused r = (TriggerResult.Refused) result;
        return new HandlerOutcome.Failed("refused", r.code(), false);
    }
}
