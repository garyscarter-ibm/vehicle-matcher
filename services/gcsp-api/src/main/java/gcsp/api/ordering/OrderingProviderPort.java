package gcsp.api.ordering;

/** The ordering system: executes a selection once per idempotency key and answers a reconcile from its own record. */
public interface OrderingProviderPort {

    /** none, synthetic or live. */
    String mode();

    String provider();

    ProviderResponse execute(OrderingScope scope, ProviderRequest request);

    /** Never creates anything: an unknown operation is not-found, never a fabricated confirmation. */
    ProviderResponse reconcile(OrderingScope scope, ProviderRequest request);

    record ProviderRequest(String operationId, String idempotencyKey, String inputDigest, String orderUuid,
            String orderNumber, String configurationId, String firstApprovalStage) {}

    enum Status { CONFIRMED, REJECTED, UNSUPPORTED, NOT_FOUND, UNKNOWN }

    /** Only a confirmed answer carries providerReference and orderStatus. */
    record ProviderResponse(Status status, String operationId, String runId, String orderUuid, String orderNumber,
            String configurationId, String orderStatus, String providerReference, String reason, boolean fictional) {

        public static ProviderResponse of(Status status, OrderingScope scope, ProviderRequest r, String reason) {
            return new ProviderResponse(status, r == null ? null : r.operationId(), scope.runId(),
                    r == null ? null : r.orderUuid(), null, null, null, null, reason, false);
        }
    }
}
