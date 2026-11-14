package gcsp.api.clock;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** One handler call. operationId is stable for this tick and handler across retries; handlers own idempotency. */
public record TickRequest(RunContext scope, String tickId, Instant now, long clockVersion, String policyVersion,
        String operationId, TickKind kind) {

    public boolean startup() {
        return kind == TickKind.STARTUP;
    }
}
