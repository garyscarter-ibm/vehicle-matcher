package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.supply.ReleaseResult;
import gcsp.api.supply.StockRelease;
import gcsp.api.supply.SupplyConfirmation;
import java.time.Instant;

/** Queues confirmations through the merged supply package; its ReleaseResult maps onto the port's result. */
public final class StockReleaseSupplyQueue implements SupplyQueuePort {

    private final StockRelease release;

    public StockReleaseSupplyQueue(StockRelease release) {
        this.release = release;
    }

    @Override
    public Result queue(RunContext scope, String commandId, Instant now, String supplyId, Instant confirmedAt,
            String sourceVersion) {
        ReleaseResult r;
        try {
            r = release.queueConfirmedSupply(scope, commandId, now,
                    new SupplyConfirmation(supplyId, "confirmed", confirmedAt, sourceVersion));
        } catch (RuntimeException e) {
            return new Unavailable("supply-queue-unavailable", "The release queue could not be reached.");
        }
        return switch (r.status()) {
            case OK -> {
                JsonNode v = r.value();
                Instant eligible = v == null || !v.hasNonNull("eligibleFrom") ? null : Ids.parse(v.get("eligibleFrom").asText());
                yield eligible == null ? new Unavailable("supply-queue-unreadable", "The release queue answered without a date.")
                        : new Queued(eligible, v.path("policyVersion").asText(null));
            }
            case UNAVAILABLE -> new Unavailable(r.code(), r.reason());
            case CONFLICT, INVALID -> new Conflict(r.code(), r.reason());
            case UNCERTAIN -> new Uncertain();
        };
    }
}
