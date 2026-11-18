package gcsp.api.ordering;

import gcsp.api.claims.ManualReviewDetails;
import gcsp.api.claims.ManualReviewDetailsHolder;
import gcsp.api.claims.ReviewResult;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one OrderingService lazily over the Agroal datasource and the bound provider; empty without persistence. */
@ApplicationScoped
public class OrderingServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    OrderingSelection selection;

    @Inject
    OrderingProviderBindings bindings;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @Inject
    ManualReviewDetailsHolder reviewDetails;

    private OrderingService service;

    public String provider() {
        return selection.provider();
    }

    public synchronized Optional<OrderingService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            AgroalDataSource ds = dataSource.get();
            service = new OrderingService(ds, new OrderingTerms(policy, clock),
                    bindings.provider(ds)).withReviewFreeze(this::freeze);
        }
        return Optional.of(service);
    }

    /** Adapts the claims freeze: ok gives the frozen snapshot, anything else its refusal code. */
    private OrderingService.ReviewFreeze.Frozen freeze(gcsp.api.persistence.Tx tx, OrderingScope scope, String holdId,
            String quoteId, long expectedHold, long expectedDraft, long version) throws Exception {
        Optional<ManualReviewDetails> details = reviewDetails.details();
        if (details.isEmpty()) return new OrderingService.ReviewFreeze.Frozen(null, "review-details-unavailable");
        ReviewResult r = details.get().freeze(tx, new ManualReviewDetails.Binding(scope.runId(), scope.employeeId(),
                scope.entitlementSlotId(), holdId, quoteId, expectedHold, expectedDraft), version);
        if (r.isOk()) return new OrderingService.ReviewFreeze.Frozen(r.value(), null);
        // An unavailable claims source stays a 503, as Node passes the freeze status through.
        String code = "unavailable".equals(r.status()) ? "review-details-unavailable" : r.code() == null ? r.status() : r.code();
        return new OrderingService.ReviewFreeze.Frozen(null, code);
    }
}
