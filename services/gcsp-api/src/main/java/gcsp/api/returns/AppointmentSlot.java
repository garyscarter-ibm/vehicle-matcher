package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;

/** One bookable appointment slot; the id is a stable text key such as slot-20261106T0900Z. */
public record AppointmentSlot(String slotId, Instant start, Instant end) {

    public boolean valid() {
        return ReturnJson.text(slotId, 64) && start != null && end != null;
    }

    public ObjectNode toJson() {
        return ReturnJson.JSON.createObjectNode().put("slotId", slotId).put("start", ReturnJson.format(start))
                .put("end", ReturnJson.format(end));
    }

    /** Null when the node is not a slot with an id and two ISO instants. */
    public static AppointmentSlot fromJson(JsonNode n) {
        if (n == null || !n.isObject()) return null;
        Instant s = ReturnJson.parse(n.path("start").asText(null));
        Instant e = ReturnJson.parse(n.path("end").asText(null));
        String id = n.path("slotId").asText(null);
        AppointmentSlot slot = new AppointmentSlot(id, s, e);
        return slot.valid() ? slot : null;
    }
}
