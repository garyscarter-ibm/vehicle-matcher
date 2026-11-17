package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Drives open remote Buddy claims and releases on every tick, startup included: that is the restart path. */
@ApplicationScoped
public class BuddyPendingOperationsTickHandler implements TickHandler {

    public static final String ID = "buddy-pending-operations";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    Persistence persistence;

    @Inject
    Allocation allocation;

    @Inject
    Instance<RemoteBuddy> remote;

    @ConfigProperty(name = BuddyTickSupport.CANDIDATES_KEY, defaultValue = "none")
    String provider;

    private BooleanSupplier active;
    private Supplier<String> candidates;
    private Supplier<RemoteBuddy> buddy;
    private Supplier<BuddyRemoteLifecycle> lifecycle;

    public BuddyPendingOperationsTickHandler() {}

    public BuddyPendingOperationsTickHandler(BooleanSupplier active, Supplier<String> candidates,
            Supplier<RemoteBuddy> buddy, Supplier<BuddyRemoteLifecycle> lifecycle) {
        this.active = active;
        this.candidates = candidates;
        this.buddy = buddy;
        this.lifecycle = lifecycle;
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
        if (!on || !BuddyTickSupport.candidatesConfigured(candidates != null ? candidates.get() : provider)) return false;
        return "remote".equals((buddy != null ? buddy.get() : remote.get()).mode());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            BuddyRemoteLifecycle service = lifecycle != null ? lifecycle.get() : allocation.lifecycle();
            return map(service.reconcile(BuddyTickSupport.scope(request)));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-pending-operations-unavailable", true);
        }
    }

    static HandlerOutcome map(ReconcileResult r) {
        ObjectNode value = BuddyTickSupport.counts();
        value.put("driven", r.driven()).put("settled", r.settled()).put("pending", r.pending())
                .put("refused", r.refused());
        return new HandlerOutcome.Ok(value);
    }
}
