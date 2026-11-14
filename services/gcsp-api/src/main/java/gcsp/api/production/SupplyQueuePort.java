package gcsp.api.production;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** Capability: hand a Production confirmation to supply's release queue. Called outside any transaction; idempotent per supplyId. */
public interface SupplyQueuePort {

    Result queue(RunContext scope, String commandId, Instant now, String supplyId, Instant confirmedAt, String sourceVersion);

    sealed interface Result {}

    record Queued(Instant eligibleFrom, String policyVersion) implements Result {}

    record Unavailable(String code, String reason) implements Result {}

    record Conflict(String code, String reason) implements Result {}

    /** The outcome is unknown; the next pass replays the same supplyId, which supply answers once. */
    record Uncertain() implements Result {}
}
