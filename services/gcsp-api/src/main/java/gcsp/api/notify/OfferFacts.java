package gcsp.api.notify;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** Port for the facts an offer notification needs; offers live in a later Story's tables. */
public interface OfferFacts {

    Result lookup(RunContext ctx, String offerId);

    sealed interface Result permits Offer, Missing, Unavailable {}

    record Offer(String offerId, String employeeId, String state, Instant expiresAt, String vehicleName,
            Integer monthlyPoints, String imagePath) implements Result {}

    record Missing() implements Result {}

    record Unavailable() implements Result {}
}
