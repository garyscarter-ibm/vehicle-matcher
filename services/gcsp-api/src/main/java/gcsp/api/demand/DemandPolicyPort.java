package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.Optional;

/** The policy values the projection reads; the service validates the raw nodes (a stand-in until gcsp.api.policy). */
public interface DemandPolicyPort {

    /** The values of exactly this policy version as of the instant, or empty when policy is not available. */
    Optional<DemandPolicy> read(String policyVersion, Instant asOf);

    /**
     * Raw values of greg.demand.smallCountThreshold (+ its status), offer.declineReasons.v1, offer.declinedCar.exclusion,
     * the essentials of employee.recommendation.v1 and allocation.tieBreak.rule.
     */
    record DemandPolicy(String policyVersion, JsonNode threshold, String thresholdStatus, JsonNode declineReasons,
            JsonNode declinedCarExclusion, JsonNode recommendationEssentials, JsonNode allocationRule) {}
}
