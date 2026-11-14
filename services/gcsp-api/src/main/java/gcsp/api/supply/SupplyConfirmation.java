package gcsp.api.supply;

import java.time.Instant;

/** A provider's confirmation reference for supply; never stock rows. */
public record SupplyConfirmation(String supplyId, String state, Instant confirmedAt, String sourceVersion) {}
