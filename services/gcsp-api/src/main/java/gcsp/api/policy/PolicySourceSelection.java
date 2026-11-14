package gcsp.api.policy;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.enterprise.inject.Typed;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;

/** The one place the policy source is chosen: PostgreSQL when persistence is active, else the retained file. */
@ApplicationScoped
public class PolicySourceSelection {

    @Inject
    PolicyDatabase database;

    /** The reviewed seed file, kept once for the process; also the origin of every run's base version. */
    @Produces
    @Singleton
    @Typed(RetainedFilePolicySource.class)
    RetainedFilePolicySource retainedFile() {
        return new RetainedFilePolicySource();
    }

    @Produces
    @ApplicationScoped
    PolicySource policySource(RetainedFilePolicySource retained) {
        return database.active() ? new PostgresPolicySource(database, retained) : retained;
    }
}
