package gcsp.api.claims;

import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.sql.SQLException;
import java.util.Optional;

/** Reads the offer id FUCQ-464 records in the Buddy hold's attributes; no id there means none is reported. */
public final class HoldOfferLookup implements SlotOccupancyPort {

    @Override
    public Optional<String> heldOfferId(Tx tx, String holdId) throws SQLException {
        RunContext x = tx.context();
        return tx.first("SELECT attributes->>'offerId' FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND hold_id = ?", rs -> rs.getString(1), x.environmentId(), x.runId(), holdId);
    }
}
