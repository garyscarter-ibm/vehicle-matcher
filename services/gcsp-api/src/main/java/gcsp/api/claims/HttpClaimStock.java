package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Ids;
import gcsp.api.remote.OperationHttpTransport.RemoteOperationException;
import gcsp.api.remote.OperationHttpTransport.Reply;
import java.util.Objects;

/** Remote claim stock over the GCSP operation transport: execute POSTs, reconcile only looks up. Errors pass through. */
public final class HttpClaimStock implements ClaimStockPort {

    private final OperationHttpTransport transport;

    public HttpClaimStock(OperationHttpTransport transport) {
        this.transport = Objects.requireNonNull(transport, "transport");
    }

    @Override
    public Mode mode() {
        return Mode.REMOTE;
    }

    @Override
    public Ack execute(Operation operation) throws RemoteOperationException {
        return map(transport.execute(ids(operation), body(operation)));
    }

    @Override
    public Ack reconcile(Operation operation) throws RemoteOperationException {
        return map(transport.reconcile(ids(operation)));
    }

    private static Ids ids(Operation op) throws RemoteOperationException {
        if (op == null) throw new RemoteOperationException("remote-operation-invalid");
        return new Ids(op.operationId(), op.runId(), op.orderUuid());
    }

    private static ObjectNode body(Operation op) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("operationId", op.operationId());
        body.put("type", op.type());
        body.put("holdId", op.holdId());
        body.put("orderUuid", op.orderUuid());
        body.put("employeeId", op.employeeId());
        body.put("slotId", op.slotId());
        body.put("expiresAt", op.expiresAt() == null ? null : op.expiresAt().toString());
        body.put("target", op.target());
        body.put("reason", op.reason());
        body.put("runId", op.runId());
        JsonNode quote = op.quote();
        body.set("quote", quote == null ? JsonNodeFactory.instance.nullNode() : quote);
        return body;
    }

    /** The transport has already matched the reply ids to the sent ids. */
    private static Ack map(Reply reply) throws RemoteOperationException {
        return switch (reply.status()) {
            case "confirmed" -> new Confirmed(reply.operationId(), reply.runId(), reply.orderUuid(),
                    reply.providerReference());
            case "rejected" -> new Rejected(reply.operationId(), reply.runId(), reply.orderUuid());
            case "not-found" -> new NotFound(reply.operationId(), reply.runId(), reply.orderUuid());
            default -> throw new RemoteOperationException("remote-ack-status-unknown");
        };
    }
}
