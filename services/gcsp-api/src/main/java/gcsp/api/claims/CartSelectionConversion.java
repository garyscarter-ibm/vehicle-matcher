package gcsp.api.claims;

import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.SelectionConversionPort;
import gcsp.api.persistence.Tx;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * The cart source for ordering (FUCQ-463): ordering's transaction locks and allocates the manual claim and car through
 * ManualClaims, so a concurrent release or expiry can never leave an order on a hold that is not allocated.
 */
@ApplicationScoped
public class CartSelectionConversion implements SelectionConversionPort {

    static final String UNAVAILABLE = "selection-source-unavailable";

    @Inject
    ManualClaimsHolder holder;

    private final Supplier<Optional<ManualClaims>> direct;

    public CartSelectionConversion() {
        this.direct = null;
    }

    /** For tests that build ManualClaims by hand instead of through the holder. */
    CartSelectionConversion(Supplier<Optional<ManualClaims>> direct) {
        this.direct = direct;
    }

    private Optional<ManualClaims> claims() {
        return direct != null ? direct.get() : holder.claims();
    }

    @Override
    public String sourceType() {
        return "cart";
    }

    @Override
    public Preparation prepare(OrderingScope scope, SourceInput source) {
        Optional<ManualClaims> claims = claims();
        if (claims.isEmpty()) return new Refusal(UNAVAILABLE);
        ClaimScope who = claimScope(scope);
        String code = claims.get().readyForOrdering(who, scope.entitlementSlotId(), source.holdId(),
                source.expectedHoldVersion(), source.expectedDraftVersion());
        if (code != null) return new Refusal(code);
        ManualSelectionPort.OrderDraft draft = claims.get().orderDraft(who);
        if (draft instanceof ManualSelectionPort.NoDecision n) return new Refusal(n.code());
        ManualSelectionPort.Draft d = (ManualSelectionPort.Draft) draft;
        return new Prepared(d.mode(), d.driver(), d.contact(), d.employee(), d.sourceVersions());
    }

    @Override
    public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest request) throws Exception {
        Optional<ManualClaims> claims = claims();
        if (claims.isEmpty()) return new Refusal(UNAVAILABLE);
        try {
            return claims.get().allocateForOrdering(tx, claimScope(scope), scope.entitlementSlotId(), request);
        } catch (gcsp.api.claims.Refusal r) {
            return new Refusal(ManualClaims.orderingCode(r.result()));
        }
    }

    private static ClaimScope claimScope(OrderingScope s) {
        return new ClaimScope(s.environmentId(), s.runId(), s.employeeId(), s.employeeId(), s.policyVersion());
    }
}
