package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** The keyed slot rule: lead days from the demo-clock date, days offered, slot length and UTC daily starts. */
public record SlotPolicy(int earliestLeadDays, int daysOffered, int slotMinutes, List<String> dailyStartTimes) {

    static final Pattern HHMM = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");
    private static final ObjectMapper JSON = new ObjectMapper();

    public SlotPolicy {
        dailyStartTimes = List.copyOf(dailyStartTimes);
    }

    /** The provider-side check (Node validPolicy); the policy file loader applies tighter bounds. */
    public boolean valid() {
        return earliestLeadDays >= 0 && daysOffered > 0 && slotMinutes > 0 && !dailyStartTimes.isEmpty()
                && dailyStartTimes.stream().allMatch(t -> t != null && HHMM.matcher(t).matches());
    }

    /** The policy, or null when the node does not hold a complete one. */
    public static SlotPolicy fromJson(JsonNode n) {
        if (!Values.object(n) || !n.path("dailyStartTimes").isArray()) return null;
        Long lead = Values.integer(n.get("earliestLeadDays"));
        Long days = Values.integer(n.get("daysOffered"));
        Long minutes = Values.integer(n.get("slotMinutes"));
        if (lead == null || days == null || minutes == null) return null;
        List<String> times = new ArrayList<>();
        for (JsonNode t : n.get("dailyStartTimes")) {
            if (!t.isTextual()) return null;
            times.add(t.asText());
        }
        SlotPolicy p = new SlotPolicy(lead.intValue(), days.intValue(), minutes.intValue(), times);
        return p.valid() ? p : null;
    }

    public ObjectNode toJson() {
        ObjectNode o = JSON.createObjectNode();
        o.put("earliestLeadDays", earliestLeadDays).put("daysOffered", daysOffered).put("slotMinutes", slotMinutes);
        ArrayNode times = o.putArray("dailyStartTimes");
        dailyStartTimes.forEach(times::add);
        return o;
    }
}
