package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.claims.ClaimScope;
import gcsp.api.claims.ManualClaims;
import gcsp.api.claims.ManualClaimsHolder;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Expires due manual claims then reconciles open remote claim operations, on every tick, startup included. */
@ApplicationScoped
public class ManualClaimExpiryTickHandler implements TickHandler {

    public static final String ID = "manual-claim-expiry";
    public static final String STAGE = "manual-expiry";
    static final String ACTOR = "system:clock";
    static final int LIMIT = 100;

    @Inject
    Persistence persistence;

    @Inject
    ManualClaimsHolder holder;

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
            ManualClaims claims = holder.claims().orElse(null);
            if (claims == null) return new HandlerOutcome.Failed("unavailable", "manual-claims-unavailable", true);
            ClaimScope scope = new ClaimScope(request.scope().environmentId(), request.scope().runId(), ACTOR, ACTOR,
                    request.policyVersion() == null ? "" : request.policyVersion());
            int expired = claims.expireDue(scope, LIMIT);
            int reconciled = claims.reconcileOpen(scope, LIMIT);
            return counts(expired, reconciled);
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "manual-claims-unavailable", true);
        }
    }

    static HandlerOutcome counts(int expired, int reconciled) {
        ObjectNode value = JsonNodeFactory.instance.objectNode();
        value.put("expired", expired).put("reconciled", reconciled);
        return new HandlerOutcome.Ok(value);
    }
}
