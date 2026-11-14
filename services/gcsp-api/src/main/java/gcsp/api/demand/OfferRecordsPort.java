package gcsp.api.demand;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

/** Offers and decisions of the run, read inside the projection's snapshot so one consistent view is published. */
public interface OfferRecordsPort {

    /** Empty when offer records are not available. */
    Optional<OfferRecords> read(Connection snapshot, DemandScope scope) throws SQLException;

    record OfferRecords(List<OfferRow> offers, List<DecisionRow> decisions) {}

    record OfferRow(String offerId, String employeeId, String orderUuid, String holdId, String state, Long briefVersion,
            String policyVersion) {}

    record DecisionRow(String offerId, String employeeId, String decision, String reasonCode, Long briefVersion,
            String policyVersion) {}
}
