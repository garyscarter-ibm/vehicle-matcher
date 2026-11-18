package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Ids;
import gcsp.api.remote.OperationHttpTransport.RemoteOperationException;
import gcsp.api.remote.OperationHttpTransport.Reply;
import java.util.Objects;

/**
 * The remote Buddy over the GCSP substitute transport (FUCQ-481). Failures propagate unchanged, so the consumers treat
 * them as an unknown answer; the provider reference has no place in an Ack and is dropped.
 */
public final class HttpRemoteBuddy implements RemoteBuddy {

    private final OperationHttpTransport transport;

    public HttpRemoteBuddy(OperationHttpTransport transport) {
        this.transport = Objects.requireNonNull(transport, "transport");
    }

    @Override
    public String mode() {
        return "remote";
    }

    @Override
    public Ack execute(RemoteOperation op) throws RemoteOperationException {
        if (op == null) throw new RemoteOperationException("remote-operation-invalid");
        return ack(transport.execute(ids(op), body(op)));
    }

    @Override
    public Ack reconcile(RemoteOperation op) throws RemoteOperationException {
        if (op == null) throw new RemoteOperationException("remote-operation-invalid");
        return ack(transport.reconcile(ids(op)));
    }

    private static Ids ids(RemoteOperation op) {
        return new Ids(op.operationId(), op.runId(), op.orderUuid());
    }

    private static Ack ack(Reply reply) {
        return new Ack(reply.status(), reply.operationId(), reply.runId(), reply.orderUuid());
    }

    /** The operation as sent: null strings and a null payload are written as JSON null. */
    static ObjectNode body(RemoteOperation op) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("operationId", op.operationId());
        body.put("operationType", op.operationType());
        body.put("runId", op.runId());
        body.put("holdId", op.holdId());
        body.put("orderUuid", op.orderUuid());
        body.put("employeeId", op.employeeId());
        JsonNode payload = op.payload();
        body.set("payload", payload == null ? JsonNodeFactory.instance.nullNode() : payload);
        body.put("attempts", op.attempts());
        return body;
    }
}
