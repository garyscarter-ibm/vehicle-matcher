package gcsp.api.offers;

import gcsp.api.offers.OfferRecords.OfferRecord;

/** The result of checking that a signed-in employee may decide an offer; FUCQ-466 acts only on Authorized. */
public sealed interface OfferAuthority permits OfferAuthority.Authorized, OfferAuthority.Refused {

    record Authorized(OfferRecord record, OfferView view) implements OfferAuthority {}

    record Refused(OfferOutcome refusal) implements OfferAuthority {}
}
