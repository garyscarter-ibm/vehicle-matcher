package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;

/** One provider write as fixed before the call, resent unchanged by a retry or reconcile; payload holds the step's extras. */
public record ProviderOperation(RunContext context, String operationId, String operationType, String orderUuid,
        String step, Slot slot, JsonNode payload, String inputDigest) {

    /** The base shape every call needs: ids, a known step with its matching type, a valid slot and a 64-hex digest. */
    public boolean valid() {
        return context != null && Values.id(operationId, 512) && AppointmentIds.isStep(step)
                && AppointmentIds.operationType(step).equals(operationType) && Values.id(orderUuid, 512)
                && slot != null && slot.valid() && payload != null && payload.isObject()
                && inputDigest != null && inputDigest.matches("^[0-9a-f]{64}$");
    }
}
