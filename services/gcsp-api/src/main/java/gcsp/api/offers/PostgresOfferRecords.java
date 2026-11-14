package gcsp.api.offers;

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

/** Offers read from Postgres in the environment's active run; any failure is unavailable, with no detail leaked. */
@ApplicationScoped
public class PostgresOfferRecords implements OfferRecords {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    private volatile OfferReads reads;

    PostgresOfferRecords() {}

    PostgresOfferRecords(BooleanSupplier active, Supplier<DataSource> source) {
        this.reads = new OfferReads(active, source);
    }

    @Override
    public Lookup find(RunContext ctx, String offerId) {
        OfferReads r = reads();
        if (!r.active()) return new Unavailable();
        try (Connection c = r.open()) {
            Optional<String> run = r.activeRun(c, ctx.environmentId());
            if (run.isEmpty()) return new Unavailable();
            Optional<OfferRecord> found = r.find(c, ctx.environmentId(), run.get(), offerId);
            if (found.isPresent()) return new Found(found.get());
            return r.inOtherRun(c, ctx.environmentId(), offerId) ? new StaleRun() : new Missing();
        } catch (SQLException | RuntimeException e) {
            return new Unavailable();
        }
    }

    @Override
    public Listing listForEmployee(RunContext ctx, String employeeId) {
        OfferReads r = reads();
        if (!r.active()) return new Unavailable();
        try (Connection c = r.open()) {
            Optional<String> run = r.activeRun(c, ctx.environmentId());
            if (run.isEmpty()) return new Unavailable();
            return new Listed(r.list(c, ctx.environmentId(), run.get(), employeeId));
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
