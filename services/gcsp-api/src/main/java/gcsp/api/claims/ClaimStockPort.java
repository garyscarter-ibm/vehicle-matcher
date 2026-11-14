package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** The stock authority behind a manual claim. REMOTE calls run outside transactions and are idempotent on operationId. */
public interface ClaimStockPort {

    enum Mode { LOCAL, REMOTE }

    Mode mode();

    /** Applies the operation remotely. */
    Ack execute(Operation operation) throws Exception;

    /** Asks the remote what it did with the operation; NotFound is authoritative only when ids match. */
    Ack reconcile(Operation operation) throws Exception;

    /** One claim, release or allocate request, with the quote pinned at claim time. */
    record Operation(String operationId, String type, String holdId, String orderUuid, String employeeId,
            String slotId, Instant expiresAt, String target, String reason, String runId, JsonNode quote) {}

    sealed interface Ack permits Confirmed, Rejected, NotFound {

        String operationId();

        String runId();

        String orderUuid();
    }

    record Confirmed(String operationId, String runId, String orderUuid, String providerReference) implements Ack {}

    record Rejected(String operationId, String runId, String orderUuid) implements Ack {}

    record NotFound(String operationId, String runId, String orderUuid) implements Ack {}
}
