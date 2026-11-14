package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** How slots are laid out: lead days from the demo clock date, days offered, length and the daily UTC start times. */
public record SlotPolicy(int earliestLeadDays, int daysOffered, int slotMinutes, List<String> dailyStartTimes) {

    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

    public SlotPolicy {
        dailyStartTimes = dailyStartTimes == null ? List.of() : List.copyOf(dailyStartTimes);
    }

    /** The provider's own sanity check; the policy reader applies the tighter keyed ranges. */
    public boolean usable() {
        return earliestLeadDays >= 0 && daysOffered > 0 && slotMinutes > 0 && !dailyStartTimes.isEmpty()
                && dailyStartTimes.stream().allMatch(t -> t != null && TIME.matcher(t).matches());
    }

    public ObjectNode toJson() {
        ObjectNode o = ReturnJson.JSON.createObjectNode();
        o.put("earliestLeadDays", earliestLeadDays).put("daysOffered", daysOffered).put("slotMinutes", slotMinutes);
        ArrayNode times = o.putArray("dailyStartTimes");
        dailyStartTimes.forEach(times::add);
        return o;
    }

    /** Null when the node is not a usable slot policy. */
    public static SlotPolicy fromJson(JsonNode n) {
        if (n == null || !n.isObject() || !n.path("dailyStartTimes").isArray()) return null;
        for (String f : new String[] {"earliestLeadDays", "daysOffered", "slotMinutes"}) {
            if (!n.path(f).isIntegralNumber() || !n.get(f).canConvertToInt()) return null;
        }
        List<String> times = new ArrayList<>();
        for (JsonNode t : n.get("dailyStartTimes")) {
            if (!t.isTextual()) return null;
            times.add(t.asText());
        }
        SlotPolicy p = new SlotPolicy(n.get("earliestLeadDays").asInt(), n.get("daysOffered").asInt(),
                n.get("slotMinutes").asInt(), times);
        return p.usable() ? p : null;
    }
}
