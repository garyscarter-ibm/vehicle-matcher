package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;

/** The port to the remote Buddy authority: claim and release calls, and a lookup of what it holds for an operation. */
public interface RemoteBuddy {

    /** "local-synthetic" (no remote call is ever made) or "remote". */
    String mode();

    /** Sends the operation; may throw or time out, and the answer may be lost. */
    Ack execute(RemoteOperation op) throws Exception;

    /** Asks what the remote holds for this operation, without sending it again. */
    Ack reconcile(RemoteOperation op) throws Exception;

    record RemoteOperation(String operationId, String operationType, String runId, String holdId, String orderUuid,
            String employeeId, JsonNode payload, int attempts) {}

    /** status is confirmed, rejected or not-found; the ids must echo the operation. */
    record Ack(String status, String operationId, String runId, String orderUuid) {}
}
