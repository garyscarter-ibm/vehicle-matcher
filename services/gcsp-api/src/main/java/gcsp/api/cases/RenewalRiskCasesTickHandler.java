package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountSelection;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.Persistence;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Opens owned cases for close deadlines and lifecycle exceptions on every tick; needs persistence and an account provider. */
@ApplicationScoped
public class RenewalRiskCasesTickHandler implements TickHandler {

    public static final String ID = "renewal-risk-cases";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    Persistence persistence;

    @Inject
    AccountSelection accountSelection;

    @Inject
    CaseServiceHolder holder;

    @Override
    public String handlerId() {
        return ID;
    }

    @Override
    public String stage() {
        return STAGE;
    }

    /** Must not touch the run clock or the case clock: the clock builds itself by asking every handler. */
    @Override
    public boolean enabled() {
        return persistence.active() && accountSelection.configured();
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            CaseService service = holder.service().orElse(null);
            if (service == null) return unavailable();
            return map(service.tick(request.scope(), request.now(), request.policyVersion()));
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    static HandlerOutcome map(CaseResult result) {
        if (result instanceof CaseResult.Ok ok) {
            JsonNode value = ok.value();
            return new HandlerOutcome.Ok(value);
        }
        return unavailable();
    }

    private static HandlerOutcome unavailable() {
        return new HandlerOutcome.Failed("unavailable", "renewal-cases-unavailable", true);
    }
}
