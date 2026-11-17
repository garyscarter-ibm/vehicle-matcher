package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Lapses due Buddy holds on each tick, startup included: a restart catches up on holds that expired meanwhile. */
@ApplicationScoped
public class BuddyExpiryTickHandler implements TickHandler {

    public static final String ID = "buddy-expiry";
    public static final String STAGE = "buddy-expiry";

    @Inject
    Persistence persistence;

    @Inject
    Allocation allocation;

    @ConfigProperty(name = BuddyTickSupport.CANDIDATES_KEY, defaultValue = "none")
    String provider;

    private BooleanSupplier active;
    private Supplier<String> candidates;
    private Supplier<BuddyExpiry> expiry;

    public BuddyExpiryTickHandler() {}

    public BuddyExpiryTickHandler(BooleanSupplier active, Supplier<String> candidates, Supplier<BuddyExpiry> expiry) {
        this.active = active;
        this.candidates = candidates;
        this.expiry = expiry;
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
            BuddyExpiry service = expiry != null ? expiry.get() : allocation.expiry();
            return map(service.expire(BuddyTickSupport.scope(request)));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-expiry-unavailable", true);
        }
    }

    static HandlerOutcome map(ExpiryResult result) {
        if (result instanceof ExpiryResult.Done done) {
            ObjectNode value = BuddyTickSupport.counts();
            value.put("expired", done.expired().size()).put("retained", done.retained().size())
                    .put("releases", done.releases().size()).put("replayed", done.replayed());
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof ExpiryResult.Pending p) return new HandlerOutcome.Failed("unavailable", p.code(), p.retryable());
        ExpiryResult.Refused r = (ExpiryResult.Refused) result;
        return new HandlerOutcome.Failed("refused", r.code(), false);
    }
}
