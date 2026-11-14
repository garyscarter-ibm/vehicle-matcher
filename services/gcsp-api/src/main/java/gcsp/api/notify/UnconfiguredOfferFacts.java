package gcsp.api.notify;

import gcsp.api.persistence.RunContext;

/** No offer store is bound: facts are unavailable, never synthesised. */
public final class UnconfiguredOfferFacts implements OfferFacts {

    @Override
    public Result lookup(RunContext ctx, String offerId) {
        return new Unavailable();
    }
}
