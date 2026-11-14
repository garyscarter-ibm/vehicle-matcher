package gcsp.api.evidence;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;

/** The stock port over the shared datasource; with persistence off every call is source-unavailable, never a fallback. */
@ApplicationScoped
public class PersistentStockPort implements StockPort {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile StockRowReader reader;

    private StockRowReader reader() {
        if (!persistence.active()) return null;
        StockRowReader current = reader;
        if (current == null) {
            synchronized (this) {
                if (reader == null) reader = new StockRowReader(dataSource.get(), persistence.guard());
                current = reader;
            }
        }
        return current;
    }

    @Override
    public RunLookup currentRun(String environmentId) {
        try {
            StockRowReader r = reader();
            return r == null ? new RunLookup("source-unavailable", null) : r.currentRun(environmentId);
        } catch (RuntimeException e) {
            return new RunLookup("source-unavailable", null);
        }
    }

    @Override
    public StockRead read(EvidenceContext context, String orderUuid) {
        try {
            StockRowReader r = reader();
            return r == null ? new StockRead("source-unavailable", null) : r.read(context, orderUuid);
        } catch (RuntimeException e) {
            return new StockRead("source-unavailable", null);
        }
    }

    @Override
    public StockClassification classify(EvidenceContext context, String orderUuid) {
        try {
            StockRowReader r = reader();
            return r == null ? StockClassification.unavailable() : r.classify(context, orderUuid);
        } catch (RuntimeException e) {
            return StockClassification.unavailable();
        }
    }
}
