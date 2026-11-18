package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;

/** Read port over the offer, hold and quote rows FUCQ-464 owns; every lookup is scoped to the environment's active run. */
public interface OfferRecords {

    Lookup find(RunContext ctx, String offerId);

    /** The employee's offers in this run, newest first, at most {@link #LIST_LIMIT}. */
    Listing listForEmployee(RunContext ctx, String employeeId);

    int LIST_LIMIT = 20;

    sealed interface Lookup permits Found, Missing, StaleRun, Unavailable {}

    record Found(OfferRecord record) implements Lookup {}

    /** No such offer. */
    record Missing() implements Lookup {}

    /** The id exists only in another, retired run of the same environment. */
    record StaleRun() implements Lookup {}

    record Unavailable() implements Lookup, Listing {}

    sealed interface Listing permits Listed, Unavailable {}

    record Listed(List<OfferSummary> offers) implements Listing {
        public Listed {
            offers = List.copyOf(offers);
        }
    }

    record OfferSummary(String offerId, String state, Instant createdAt) {}

    /** One offer with its hold and pinned quote; holdId stays inside the service. */
    record OfferRecord(
            String offerId,
            String employeeId,
            String holdId,
            String holdState,
            String quoteId,
            String orderUuid,
            String configurationId,
            String state,
            Instant expiresAt,
            long version,
            long holdVersion,
            Instant createdAt,
            String policyVersion,
            String briefVersion,
            Instant quotedAt,
            Instant validUntil,
            Integer monthlyPoints,
            String vehicleName,
            String imagePath,
            String gateStatus,
            Projection projection) {
        /** Compact application fixtures/readers need no browser facts; HTTP never falls back to these fields. */
        public OfferRecord(String offerId, String employeeId, String holdId, String holdState, String quoteId,
                String orderUuid, String configurationId, String state, Instant expiresAt, long version,
                long holdVersion, Instant createdAt, String policyVersion, String briefVersion, Instant quotedAt,
                Instant validUntil, Integer monthlyPoints, String vehicleName, String imagePath, String gateStatus) {
            this(offerId, employeeId, holdId, holdState, quoteId, orderUuid, configurationId, state, expiresAt, version,
                    holdVersion, createdAt, policyVersion, briefVersion, quotedAt, validUntil, monthlyPoints,
                    vehicleName, imagePath, gateStatus, null);
        }
    }

    /** Persisted, exact-offer browser inputs, kept private until the employee ownership guard succeeds. */
    record Projection(String runId, String slotId, String clockVersion, JsonNode quote, String orderNumber,
            String decisionId) {}
}
