package gcsp.api.clock.bound;

import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.BuddyRemoteLifecycle;
import gcsp.api.allocation.EligibleCandidates;
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

/** Drives open remote Buddy claims and releases; registered only for the remote provider, startup included. */
@ApplicationScoped
public class BuddyPendingOperationsTickHandler implements TickHandler {

    public static final String ID = "buddy-pending-operations";
    public static final String STAGE = "pending-reconciliation";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    @Inject
    PolicyService policy;

    @Inject
    Instance<EligibleCandidates> candidates;

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
        return persistence.active() && "remote".equals(remote.get().mode());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        try {
            AllocationScope scope = new AllocationScope(request.scope().environmentId(), request.scope().runId(),
                    request.policyVersion(), request.now(), request.clockVersion());
            BuddyRemoteLifecycle lifecycle = new BuddyRemoteLifecycle(sources.get(), policy, candidates.get(),
                    remote.get());
            return OfferDecisionTickHandler.map(lifecycle.reconcile(scope));
        } catch (RuntimeException e) {
            return new HandlerOutcome.Failed("unavailable", "buddy-pending-operations-unavailable", true);
        }
    }
}
