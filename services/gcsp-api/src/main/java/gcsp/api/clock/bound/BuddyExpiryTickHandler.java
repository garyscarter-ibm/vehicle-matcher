package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.BuddyExpiry;
import gcsp.api.allocation.ExpiryResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;

/** Lapses due Buddy holds at the tick's instant, on every tick, startup included; replaying a tick changes nothing. */
@ApplicationScoped
public class BuddyExpiryTickHandler implements TickHandler {

    public static final String ID = "buddy-expiry";
    public static final String STAGE = "buddy-expiry";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    @Inject
    PolicyService policy;

    @Inject
    Instance<RemoteBuddy> remote;

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
        return persistence.active();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            AllocationScope scope = new AllocationScope(request.scope().environmentId(), request.scope().runId(),
                    request.policyVersion(), request.now(), request.clockVersion());
            return map(new BuddyExpiry(sources.get(), policy, remote.get()).expire(scope));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-expiry-unavailable", true);
        }
    }

    static HandlerOutcome map(ExpiryResult result) {
        if (result instanceof ExpiryResult.Done done) {
            ObjectNode value = JsonNodeFactory.instance.objectNode();
            value.put("expired", done.expired().size()).put("retained", done.retained().size())
                    .put("releases", done.releases().size()).put("replayed", done.replayed());
            return new HandlerOutcome.Ok(value);
        }
        if (result instanceof ExpiryResult.Pending p) {
            return "stale-run".equals(p.code()) ? stale() : new HandlerOutcome.Failed("unavailable", p.code(), p.retryable());
        }
        ExpiryResult.Refused r = (ExpiryResult.Refused) result;
        String status = "command-input-changed".equals(r.code()) ? "conflict" : "invalid";
        return new HandlerOutcome.Failed(status, r.code(), false);
    }

    private static HandlerOutcome stale() {
        return new HandlerOutcome.Failed("stale-run", "stale-run", false);
    }
}
