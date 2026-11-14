package gcsp.api.appointments;

import java.time.Instant;

/** A provider's typed answer. Anything the service cannot match to the expected success is treated as unknown. */
public sealed interface ProviderAnswer {

    /** The successes: each names the operation, order and step it answers, with the provider's own reference. */
    sealed interface Done extends ProviderAnswer {
        String operationId();

        String orderUuid();

        String step();

        Slot slot();

        String providerReference();

        Instant at();
    }

    /** Request step accepted; slot is the requested one. */
    record Accepted(String operationId, String orderUuid, String step, Slot slot, String providerReference, Instant at)
            implements Done {}

    /** Confirm or accept step: the appointment is booked in slot. */
    record Scheduled(String operationId, String orderUuid, String step, Slot slot, String providerReference, Instant at)
            implements Done {}

    /** Confirm step: the retailer offers proposedSlot instead of slot. */
    record Proposed(String operationId, String orderUuid, String step, Slot slot, String providerReference, Instant at,
            Slot proposedSlot, String proposalId, String reason) implements Done {}

    /** Complete step: the handover happened at the given instant. */
    record Completed(String operationId, String orderUuid, String step, Slot slot, String providerReference, Instant at)
            implements ProviderAnswer.Done {}

    /** Confirm step before its delay has passed; nothing was recorded. */
    record InProgress(String operationId, String orderUuid, String step) implements ProviderAnswer {}

    /** Reconcile: the provider never received this operation. */
    record NotFound(String operationId, String orderUuid, String step) implements ProviderAnswer {}

    /** The provider refuses this kind of call; it is never retried. */
    record Unsupported(String code, String reason) implements ProviderAnswer {}

    /** Reconcile: the stored input differs from the one resent. */
    record Conflict(String reason) implements ProviderAnswer {}

    /** No usable answer (a throw, a timeout or nothing wired). */
    record Unknown() implements ProviderAnswer {}
}
