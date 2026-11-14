package gcsp.api.documents;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.Locale;

/** Deterministic synthetic provider: due work completes, or fails when the pinned scenario selected it. */
public final class SyntheticDocumentProvider implements DocumentProviderPort {

    private static final int MAX = 512;
    private static final String INVALID = "invalid-document-operation";

    @Override
    public String mode() {
        return "synthetic";
    }

    @Override
    public boolean supportsAcknowledgement() {
        return true;
    }

    @Override
    public Result start(Operation op) {
        if (!valid(op)) return invalid(op == null ? null : op.operationId());
        return new Result("accepted", op.operationId(), reference("SYN-DOC-", op.operationId()), null, null);
    }

    @Override
    public Result progress(Operation op, Instant now) {
        if (!valid(op) || now == null) return invalid(op == null ? null : op.operationId());
        if (now.isBefore(op.progressAt())) return new Result("in-progress", op.operationId(), null, null, null);
        if (op.fail()) return new Result("failed", op.operationId(), null, op.failureReason(), null);
        return new Result("complete", op.operationId(), null, null, null);
    }

    @Override
    public Result acknowledge(Acknowledgement ack) {
        if (!validAcknowledgement(ack)) return invalid(ack == null ? null : ack.operationId());
        String reference = reference("SYN-ACK-", ack.operationId());
        ObjectNode evidence = JsonNodeFactory.instance.objectNode()
                .put("kind", "synthetic-acknowledgement")
                .put("label", "Acknowledged. Not a signature.")
                .put("operationId", ack.operationId())
                .put("at", ack.at().toString())
                .put("actorId", ack.actorId())
                .put("providerReference", reference)
                .put("fictional", true);
        return new Result("acknowledged", ack.operationId(), reference, null, evidence);
    }

    private static boolean valid(Operation op) {
        return op != null && text(op.operationId()) && text(op.runId()) && text(op.orderUuid()) && text(op.itemId())
                && op.openedAt() != null && op.progressAt() != null;
    }

    private static boolean validAcknowledgement(Acknowledgement ack) {
        return ack != null && text(ack.operationId()) && text(ack.runId()) && text(ack.orderUuid())
                && text(ack.itemId()) && text(ack.actorId()) && ack.at() != null;
    }

    private static boolean text(String value) {
        return value != null && !value.isBlank() && value.length() <= MAX;
    }

    /** The prefix and the first twelve characters of the operation, upper-cased. */
    private static String reference(String prefix, String operationId) {
        return prefix + operationId.substring(0, Math.min(12, operationId.length())).toUpperCase(Locale.ROOT);
    }

    private static Result invalid(String operationId) {
        return new Result("unsupported", operationId, null, INVALID, null);
    }
}
