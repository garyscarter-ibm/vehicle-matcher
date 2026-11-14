package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;
import java.time.Instant;

/** Capability ordering.approvalStatus.v1: asks the ordering side to decide a stage, and reconciles what it decided. */
public interface ApprovalStatusProvider {

    /** synthetic, live or none. */
    String mode();

    String provider();

    Response requestDecision(RunContext ctx, Request request);

    Response reconcile(RunContext ctx, Request request);

    record Request(String operationId, String runId, String orderUuid, String stage, String intendedDecision,
            String inputDigest, Instant occurredAt) {}

    enum Status { CONFIRMED, UNSUPPORTED, NOT_FOUND, UNAVAILABLE, UNKNOWN, CONFLICT }

    /** state is approved or declined; only a confirmed response carries a providerReference and decidedAt. */
    record Response(Status status, String operationId, String orderUuid, String stage, String state,
            String providerReference, Instant decidedAt, String code, String reason, boolean fictional) {

        public static Response of(Status status, Request r, String code, String reason) {
            return new Response(status, r.operationId(), r.orderUuid(), r.stage(), null, null, null, code, reason, false);
        }
    }
}
