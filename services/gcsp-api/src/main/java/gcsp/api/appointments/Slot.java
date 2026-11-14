package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** One bookable handover slot; start and end are millisecond ISO UTC text. */
public record Slot(String slotId, String start, String end) {

    private static final ObjectMapper JSON = new ObjectMapper();

    public boolean valid() {
        return slotId != null && !slotId.isEmpty() && slotId.length() <= 64 && Iso.valid(start) && Iso.valid(end);
    }

    /** The slot, or null when the node is not a valid slot object. */
    public static Slot fromJson(JsonNode n) {
        if (!Values.object(n)) return null;
        Slot s = new Slot(n.path("slotId").asText(null), n.path("start").asText(null), n.path("end").asText(null));
        return n.path("slotId").isTextual() && n.path("start").isTextual() && n.path("end").isTextual() && s.valid()
                ? s : null;
    }

    public ObjectNode toJson() {
        return JSON.createObjectNode().put("slotId", slotId).put("start", start).put("end", end);
    }
}
