package gcsp.api.claims;

import gcsp.api.persistence.Tx;
import java.util.Optional;

/** Default occupancy lookup: no buddy offers table is connected yet, so no offer id is found. */
public final class NoOfferLookup implements SlotOccupancyPort {

    @Override
    public Optional<String> heldOfferId(Tx tx, String holdId) {
        return Optional.empty();
    }
}
