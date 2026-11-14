package gcsp.api.claims;

import gcsp.api.persistence.Tx;
import java.sql.SQLException;
import java.util.Optional;

/** Finds the offer behind a Buddy hold inside the claim transaction; binds to FUCQ-464's buddy_offers (by hold_id) once merged. */
public interface SlotOccupancyPort {

    Optional<String> heldOfferId(Tx tx, String holdId) throws SQLException;
}
