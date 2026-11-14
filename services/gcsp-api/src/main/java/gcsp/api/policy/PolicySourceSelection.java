package gcsp.api.policy;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

/** The one place the policy source is chosen; later slices extend it with the PostgreSQL source. */
@ApplicationScoped
public class PolicySourceSelection {

    @Produces
    @ApplicationScoped
    PolicySource policySource() {
        return new RetainedFilePolicySource();
    }
}
