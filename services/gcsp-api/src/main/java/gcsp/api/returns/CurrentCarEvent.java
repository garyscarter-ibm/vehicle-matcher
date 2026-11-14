package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.regex.Pattern;

/**
 * One confirmed fact that changes the current car: a collected handover or a confirmed return. {@code vin}, {@code
 * oldContractId} and {@code location} apply to one type each; appointmentSlotId and appointmentReference name the visit.
 */
public record CurrentCarEvent(String type, String orderUuid, String employeeId, Instant occurredAt,
        String providerReference, String oldContractId, String vin, JsonNode location, String appointmentSlotId,
        String appointmentReference) {

    public static final String HANDOVER_COMPLETED = "handover-completed";
    public static final String RETURN_CONFIRMED = "return-confirmed";
    private static final Pattern VIN = Pattern.compile("^[A-HJ-NPR-Z0-9]{17}$");

    /** The refusal reason when the event is malformed, or null when it can be applied. */
    String problem() {
        if (!HANDOVER_COMPLETED.equals(type) && !RETURN_CONFIRMED.equals(type)) {
            return "Only a confirmed handover completion or return changes the current car.";
        }
        if (!ReturnJson.text(orderUuid, 128) || !ReturnJson.text(employeeId, 128)) return "Supply the exact order and employee.";
        if (occurredAt == null || !ReturnJson.text(providerReference, 128)) {
            return "Supply the confirmed time and provider reference.";
        }
        if (!ReturnJson.text(appointmentSlotId, 64) || !ReturnJson.text(appointmentReference, 128)) {
            return "Supply the confirmed appointment.";
        }
        if (RETURN_CONFIRMED.equals(type) && !ReturnJson.text(oldContractId, 128)) return "Supply the returned contract.";
        if (HANDOVER_COMPLETED.equals(type) && vin != null && !VIN.matcher(vin).matches()) {
            return "A delivered car VIN has 17 characters.";
        }
        if (location != null && !location.isNull() && !location.isObject()) return "The return place must be an object.";
        return null;
    }

    boolean isReturn() {
        return RETURN_CONFIRMED.equals(type);
    }

    /** The immutable record of the event: what is digested, stored and later shown as a change. */
    ObjectNode payload() {
        ObjectNode o = ReturnJson.JSON.createObjectNode();
        o.put("type", type).put("orderUuid", orderUuid).put("employeeId", employeeId)
                .put("occurredAt", ReturnJson.format(occurredAt)).put("providerReference", providerReference);
        if (oldContractId != null) o.put("oldContractId", oldContractId);
        o.put("vin", vin);
        o.set("location", location == null ? ReturnJson.JSON.nullNode() : location);
        o.set("appointment", ReturnJson.JSON.createObjectNode().put("purpose", isReturn() ? "return" : "handover")
                .put("slotId", appointmentSlotId).put("providerReference", appointmentReference));
        return o;
    }
}
