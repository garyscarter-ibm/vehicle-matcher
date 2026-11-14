package gcsp.api.allocation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Set;

/** The event that returns stock to allocation; buddy-expired and offer-declined carry the returned hold ids. */
public record Trigger(String type, String sourceEventId, List<String> holdIds, List<String> orderUuids) {

    static final Set<String> TYPES = Set.of("stock-released", "brief-changed", "buddy-expired", "offer-declined");
    private static final ObjectMapper JSON = new ObjectMapper();

    public Trigger {
        holdIds = holdIds == null ? List.of() : List.copyOf(holdIds);
        orderUuids = orderUuids == null ? List.of() : List.copyOf(orderUuids);
    }

    boolean returnsHolds() {
        return "buddy-expired".equals(type) || "offer-declined".equals(type);
    }

    /** A message when the trigger cannot be used, else null. */
    String problem() {
        if (type == null || !TYPES.contains(type)) return "The trigger type is not recognised.";
        if (sourceEventId == null || sourceEventId.isBlank() || sourceEventId.length() > 512) {
            return "The trigger needs a source event id of 1 to 512 characters.";
        }
        if (returnsHolds() && (holdIds.isEmpty() || holdIds.stream().anyMatch(Trigger::blank))) {
            return "An expiry or decline trigger needs the returned hold ids.";
        }
        if (orderUuids.stream().anyMatch(Trigger::blank)) return "Order ids must not be blank.";
        return null;
    }

    /** The trigger's own fields: the input digest of its allocation. */
    ObjectNode json() {
        ObjectNode o = JSON.createObjectNode();
        o.put("type", type);
        o.put("sourceEventId", sourceEventId);
        ArrayNode holds = o.putArray("holdIds");
        holdIds.forEach(holds::add);
        ArrayNode orders = o.putArray("orderUuids");
        orderUuids.forEach(orders::add);
        return o;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
