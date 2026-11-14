package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/**
 * Document status capability of the selected ordering provider, chosen at startup. An adapter that cannot do an
 * operation answers unsupported; it never reports success it did not get from its source.
 */
public interface DocumentProviderPort {

    String CAPABILITY = "ordering.documentStatus.v1";

    /** synthetic, unsupported or none. */
    String mode();

    /** False means acknowledge always answers unsupported, so commands refuse before recording intent. */
    boolean supportsAcknowledgement();

    record Operation(String operationId, String runId, String orderUuid, String itemId, boolean fail,
            String failureReason, Instant openedAt, Instant progressAt) {}

    record Acknowledgement(String operationId, String runId, String orderUuid, String itemId, String actorId,
            Instant at) {}

    /**
     * start: accepted | unsupported | unavailable. progress: in-progress | complete | failed | unsupported |
     * unavailable. acknowledge: acknowledged | refused | pending | unsupported | unavailable. evidence is the
     * provider's acknowledgement record (acknowledged only).
     */
    record Result(String status, String operationId, String providerReference, String reason, JsonNode evidence) {}

    Result start(Operation op);

    Result progress(Operation op, Instant now);

    Result acknowledge(Acknowledgement ack);
}
