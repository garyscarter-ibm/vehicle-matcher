package gcsp.api.documents;

import java.time.Instant;

/** Refuses every document write, so it never reports a success the provider did not give. */
public final class UnsupportedDocumentProvider implements DocumentProviderPort {

    private static final String REASON = "Live document and readiness writes are not supported yet.";

    @Override
    public String mode() {
        return "unsupported";
    }

    @Override
    public boolean supportsAcknowledgement() {
        return false;
    }

    @Override
    public Result start(Operation op) {
        return refused(op == null ? null : op.operationId());
    }

    @Override
    public Result progress(Operation op, Instant now) {
        return refused(op == null ? null : op.operationId());
    }

    @Override
    public Result acknowledge(Acknowledgement ack) {
        return refused(ack == null ? null : ack.operationId());
    }

    private static Result refused(String operationId) {
        return new Result("unsupported", operationId, null, REASON, null);
    }
}
