package gcsp.api.ordering;

import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;

/** Binds approvals' order source to the acknowledged selections; unavailable while persistence is off. */
@ApplicationScoped
public class ActiveOrderSource implements OrderSourcePort {

    static final String CODE = "order-source-not-configured";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile OrderingOrderSource delegate;

    private synchronized OrderingOrderSource delegate() {
        if (delegate == null) delegate = new OrderingOrderSource(dataSource.get());
        return delegate;
    }

    @Override
    public String mode() {
        return persistence.active() ? "ordering" : "none";
    }

    @Override
    public Found find(RunContext ctx, String orderUuid) {
        return persistence.active() ? delegate().find(ctx, orderUuid) : new Unavailable(CODE);
    }

    @Override
    public Listing list(RunContext ctx, String after, int limit) {
        return persistence.active() ? delegate().list(ctx, after, limit) : new Unavailable(CODE);
    }
}
