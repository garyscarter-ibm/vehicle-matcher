package gcsp.api.offers;

import gcsp.api.persistence.RunContext;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** In-memory offer records for the HTTP test; ids in STALE exist only in a retired run. */
final class OffersTestPorts {

    static final Map<String, OfferRecords.OfferRecord> OFFERS = new ConcurrentHashMap<>();
    static final Set<String> STALE = ConcurrentHashMap.newKeySet();

    private OffersTestPorts() {}

    @Alternative
    @Priority(1)
    @ApplicationScoped
    public static class Records implements OfferRecords {
        @Override
        public Lookup find(RunContext ctx, String offerId) {
            OfferRecord r = OFFERS.get(offerId);
            if (r != null) return new Found(r);
            return STALE.contains(offerId) ? new StaleRun() : new Missing();
        }

        @Override
        public Listing listForEmployee(RunContext ctx, String employeeId) {
            List<OfferSummary> rows = OFFERS.values().stream().filter((r) -> employeeId.equals(r.employeeId()))
                    .sorted(Comparator.comparing(OfferRecord::createdAt).reversed())
                    .map((r) -> new OfferSummary(r.offerId(), r.state(), r.createdAt())).toList();
            return new Listed(rows);
        }
    }
}
