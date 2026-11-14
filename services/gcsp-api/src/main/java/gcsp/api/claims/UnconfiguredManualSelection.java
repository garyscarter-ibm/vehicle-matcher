package gcsp.api.claims;

/** Default selection: manual browse and eligibility are not connected, so every call is unavailable. */
public final class UnconfiguredManualSelection implements ManualSelectionPort {

    static final String CODE = "manual-selection-not-configured";

    @Override
    public Claimant claimant(ClaimScope scope) {
        return new NoClaimant(CODE);
    }

    @Override
    public Decision decide(ClaimScope scope, String orderUuid) {
        return new NoDecision(CODE);
    }
}
