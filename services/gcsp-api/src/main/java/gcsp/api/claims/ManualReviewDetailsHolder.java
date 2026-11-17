package gcsp.api.claims;

import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ManualReviewDetails lazily over the datasource, claims and policy; empty without persistence. */
@ApplicationScoped
public class ManualReviewDetailsHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ClaimClock clock;

    @Inject
    ManualClaimsHolder claims;

    @Inject
    PolicyService policy;

    private ManualReviewDetails details;

    public synchronized Optional<ManualReviewDetails> details() {
        Optional<ManualClaims> manual = claims.claims();
        if (manual.isEmpty()) return Optional.empty();
        if (details == null) {
            details = new ManualReviewDetails(dataSource.get(), persistence.runner(), clock, manual.get(), policy);
        }
        return Optional.of(details);
    }
}
