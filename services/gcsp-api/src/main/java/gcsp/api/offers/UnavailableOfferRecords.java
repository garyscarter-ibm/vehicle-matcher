package gcsp.api.offers;

import gcsp.api.persistence.RunContext;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** Default port until the Postgres adapter lands: answers unavailable, never synthesises an offer. */
@DefaultBean
@ApplicationScoped
public class UnavailableOfferRecords implements OfferRecords {

    @Override
    public Lookup find(RunContext ctx, String offerId) {
        return new Unavailable();
    }

    @Override
    public Listing listForEmployee(RunContext ctx, String employeeId) {
        return new Unavailable();
    }
}
