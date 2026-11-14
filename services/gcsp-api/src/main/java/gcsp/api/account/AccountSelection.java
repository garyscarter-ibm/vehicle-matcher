package gcsp.api.account;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.Startup;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.Config;
import org.jboss.logging.Logger;

/** Chooses the account ports once at startup; an unknown or disallowed setting stops the service. */
@ApplicationScoped
public class AccountSelection {

    public static final String NONE = "none";
    public static final String HR_SNAPSHOT = "hr-snapshot";
    public static final String REPOSITORY = "repository";
    private static final Logger LOG = Logger.getLogger(AccountSelection.class);

    @Inject
    Config config;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    public String mode() {
        return normalise(config.getOptionalValue("gcsp.account.provider", String.class).orElse(NONE));
    }

    public boolean configured() {
        return !NONE.equals(mode());
    }

    @Produces
    @Startup
    @ApplicationScoped
    AccountRecordsPort records() {
        AccountRecordsPort port = records(mode(), config.getOptionalValue("gcsp.account.hr-snapshot.path", String.class).orElse(null),
                persistence.active() ? () -> dataSource.get() : null);
        LOG.infof("GCSP account provider: %s", mode());
        return port;
    }

    @Produces
    @Startup
    @ApplicationScoped
    AccountClockPort clock() {
        return clock(config.getOptionalValue("gcsp.account.fixed-now", String.class).orElse(null), LaunchMode.current());
    }

    @Produces
    @ApplicationScoped
    CurrentCarPort currentCars() {
        return new NoCurrentCarRelationships();
    }

    @Produces
    @ApplicationScoped
    AccountPolicyPort policy() {
        // The canonical PolicyService adapter replaces this at integration.
        return new UnconfiguredAccountPolicy();
    }

    @Produces
    @Singleton
    AccountService accountService(AccountRecordsPort records, AccountPolicyPort policy, AccountClockPort clock,
            CurrentCarPort cars) {
        return new AccountService(records, policy, clock, cars);
    }

    /** Pure selection rule, static so the refusal cases are unit-testable without a server. */
    static AccountRecordsPort records(String provider, String snapshotPath) {
        return records(provider, snapshotPath, null);
    }

    /** The data source supplier is null when persistence is not active. */
    static AccountRecordsPort records(String provider, String snapshotPath, Supplier<? extends DataSource> repository) {
        String name = normalise(provider);
        switch (name) {
            case NONE:
                return new UnconfiguredAccountRecords();
            case HR_SNAPSHOT:
                return HrSnapshotRecords.open(snapshotPath);
            case REPOSITORY:
                if (repository == null) {
                    throw new IllegalStateException("gcsp.account.provider=repository needs persistence: set GCSP_DATABASE_URL");
                }
                return new RepositoryAccountRecords(repository.get());
            default:
                throw new IllegalStateException("Unknown gcsp.account.provider '" + name + "'; supported: "
                        + NONE + ", " + HR_SNAPSHOT + ", " + REPOSITORY);
        }
    }

    static AccountClockPort clock(String fixedNow, LaunchMode mode) {
        if (fixedNow == null || fixedNow.isBlank()) return new SystemAccountClock();
        if (mode != LaunchMode.TEST) {
            throw new IllegalStateException("gcsp.account.fixed-now is only allowed in automated tests");
        }
        if (Js.epochMillis(fixedNow.trim()) == null) {
            throw new IllegalStateException("gcsp.account.fixed-now must be an ISO instant such as 2026-11-05T09:00:00.000Z");
        }
        return new FixedAccountClock(fixedNow.trim());
    }

    private static String normalise(String provider) {
        return provider == null || provider.isBlank() ? NONE : provider.trim();
    }
}
