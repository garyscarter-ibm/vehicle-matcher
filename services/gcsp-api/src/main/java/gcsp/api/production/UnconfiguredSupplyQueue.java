package gcsp.api.production;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** No release queue is connected: confirmations are kept and stay unqueued. */
public final class UnconfiguredSupplyQueue implements SupplyQueuePort {

    static final String CODE = "supply-queue-not-configured";

    @Override
    public Result queue(RunContext scope, String commandId, Instant now, String supplyId, Instant confirmedAt,
            String sourceVersion) {
        return new Unavailable(CODE, "The release queue is not connected yet. Confirmed supply is saved.");
    }
}
