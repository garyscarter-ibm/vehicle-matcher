package gcsp.api.documents;

import java.time.Instant;

/** The default when no document provider is configured: every operation reports unavailable. */
public final class UnconfiguredDocumentProvider implements DocumentProviderPort {

    private static final String REASON = "document-provider-not-configured";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public boolean supportsAcknowledgement() {
        return false;
    }

    @Override
    public Result start(Operation op) {
        return unavailable(op == null ? null : op.operationId());
    }

    @Override
    public Result progress(Operation op, Instant now) {
        return unavailable(op == null ? null : op.operationId());
    }

    @Override
    public Result acknowledge(Acknowledgement ack) {
        return unavailable(ack == null ? null : ack.operationId());
    }

    private static Result unavailable(String operationId) {
        return new Result("unavailable", operationId, null, REASON, null);
    }
}
