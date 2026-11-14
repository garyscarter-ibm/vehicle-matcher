package gcsp.api.offers;

import gcsp.api.notify.OfferFacts;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Optional;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** The notification facts for an offer, read in exactly the run the caller scopes; never synthesised. */
@ApplicationScoped
public class PostgresOfferFacts implements OfferFacts {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    private volatile OfferReads reads;

    PostgresOfferFacts() {}

    PostgresOfferFacts(BooleanSupplier active, Supplier<DataSource> source) {
        this.reads = new OfferReads(active, source);
    }

    @Override
    public Result lookup(RunContext ctx, String offerId) {
        OfferReads r = reads();
        if (!r.active()) return new Unavailable();
        try (Connection c = r.open()) {
            Optional<OfferReads.Facts> found = r.facts(c, ctx.environmentId(), ctx.runId(), offerId);
            if (found.isEmpty()) return new Missing();
            OfferReads.Facts f = found.get();
            return new Offer(offerId, f.employeeId(), f.state(), f.expiresAt(), f.vehicleName(), f.monthlyPoints(),
                    f.imagePath());
        } catch (SQLException | RuntimeException e) {
            return new Unavailable();
        }
    }

    private OfferReads reads() {
        OfferReads r = reads;
        if (r == null) {
            r = new OfferReads(persistence::active, sources::get);
            reads = r;
        }
        return r;
    }
}
