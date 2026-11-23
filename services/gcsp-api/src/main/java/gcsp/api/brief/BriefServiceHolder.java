package gcsp.api.brief;

import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one BriefService lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class BriefServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    BriefPolicyPort policy;

    @Inject
    BriefAccountPort account;

    @Inject
    BriefOfferPort offers;

    @Inject
    BriefPreviewPort preview;

    @Inject
    RunClockHolder clocks;

    private BriefService service;

    public synchronized Optional<BriefService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) service = new BriefService(dataSource.get(), policy, account, offers, preview,
                (environmentId, runId) -> clocks.clock().now(environmentId, runId));
        return Optional.of(service);
    }
}
