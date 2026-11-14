package gcsp.api.allocation;

import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;

/** The allocation seam for tick handlers: one service, built only when persistence is on. */
@ApplicationScoped
public class Allocation {

    @Inject
    Persistence persistence;

    @Inject
    PolicyService policy;

    @Inject
    Instance<EligibleCandidates> candidates;

    @Inject
    Instance<RemoteBuddy> remote;

    @Inject
    Instance<AgroalDataSource> sources;

    private AllocationService service;

    public boolean available() {
        return persistence.active();
    }

    /** Built once, on first use. */
    public synchronized AllocationService service() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        if (service == null) service = new AllocationService(sources.get(), policy, candidates.get(), remote.get());
        return service;
    }
}
