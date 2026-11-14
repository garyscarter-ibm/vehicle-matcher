package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** Manual browse and eligibility as claims need them (FUCQ-461/442, not built in Java yet); the default is unavailable. */
public interface ManualSelectionPort {

    Claimant claimant(ClaimScope scope);

    Decision decide(ClaimScope scope, String orderUuid);

    sealed interface Claimant {}

    /** The employee's slot, the context and draft versions their claim is checked against, and their policy version. */
    record Known(String slotId, String contextVersion, long draftVersion, String driverId, String policyVersion)
            implements Claimant {}

    record NoClaimant(String code) implements Claimant {}

    sealed interface Decision {}

    /** facts must still equal the car's attributes; terms are pinned and digested as given, so leave volatile fields out. */
    record Eligible(String configurationId, JsonNode facts, JsonNode terms, Instant validUntil) implements Decision {}

    record NotEligible(String reason) implements Decision {}

    record NoDecision(String code) implements Decision {}
}
