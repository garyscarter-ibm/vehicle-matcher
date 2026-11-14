package gcsp.api.claims;

import gcsp.api.persistence.Tx;
import java.sql.SQLException;
import java.util.Optional;

/** Finds the offer behind a Buddy hold inside the claim transaction; the default reads the hold's offerId attribute. */
public interface SlotOccupancyPort {

    Optional<String> heldOfferId(Tx tx, String holdId) throws SQLException;
}
