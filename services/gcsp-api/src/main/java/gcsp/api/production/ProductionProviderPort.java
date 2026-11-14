package gcsp.api.production;

import java.time.Instant;
import java.util.List;

/**
 * Capability supply.production.v1. Both write calls run outside any transaction and answer once per operation id,
 * so a repeat returns the same answer; an Answer is the provider's whole current view, so applying it twice is safe.
 */
public interface ProductionProviderPort {

    /** none, synthetic or live. */
    String mode();

    Description describe();

    Answer submit(Operation operation);

    Answer reconcile(Operation operation);

    record Operation(String environmentId, String runId, String operationId, String model, String derivative,
            int quantity, Instant requestedAt, String inputDigest) {}

    enum Status { REQUESTED, CONFIRMED, DELAYED, REFUSED, UNSUPPORTED, NOT_FOUND, CONFLICT, UNAVAILABLE }

    record Confirmation(String supplyId, int quantity, Instant confirmedAt) {}

    /** CONFIRMED carries some or all of the quantity; delayUntil may accompany a partial confirmation. */
    record Answer(Status status, String operationId, String providerReference, List<Confirmation> confirmations,
            Instant delayUntil, String reason, String code, String sourceVersion, boolean fictional) {

        public static Answer of(Status status, String operationId, String code, String reason) {
            return new Answer(status, operationId, null, List.of(), null, reason, code, null, false);
        }
    }

    record Choice(String model, String derivative) {}

    record Description(String mode, String provider, String sourceVersion, String status, List<Choice> choices) {}
}
