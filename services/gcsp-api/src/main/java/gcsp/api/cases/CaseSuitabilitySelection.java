package gcsp.api.cases;

import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountSelection;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import java.util.Optional;
import org.jboss.logging.Logger;

/** Binds alternative-car suitability to the Java recommendation when persistence and an account provider exist. */
@ApplicationScoped
public class CaseSuitabilitySelection {

    private static final Logger LOG = Logger.getLogger(CaseSuitabilitySelection.class);

    @Inject
    Persistence persistence;

    @Inject
    AccountSelection accounts;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AccountRecordsPort records;

    @Inject
    PolicyService policy;

    @Inject
    RunClockHolder clock;

    @Produces
    @ApplicationScoped
    CaseCarSuitabilityPort suitability() {
        boolean real = persistence.active() && accounts.configured();
        LOG.infof("GCSP case car suitability: %s", real ? "recommendation" : "none");
        if (!real) return new CaseDefaults.NoSuitability();
        return new RecommendationCaseSuitability(dataSource.get(), records, policy, this::reading);
    }

    /** The run clock's reading, empty when there is no run clock row or it cannot be read. */
    Optional<ClockReading> reading(String environmentId, String runId) {
        if (!clock.available()) return Optional.empty();
        try {
            return clock.clock().now(environmentId, runId);
        } catch (ClockUnavailableException e) {
            return Optional.empty();
        }
    }
}
