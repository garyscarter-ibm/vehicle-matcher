package gcsp.api.brief;

import java.util.List;

/** The employee's offers: an accepted one makes the brief read-only; all are listed on the activity projection. */
public interface BriefOfferPort {

    List<Offer> offers(String environmentId, String runId, String employeeId);

    record Offer(String offerId, String state, Long briefVersion) {}
}
