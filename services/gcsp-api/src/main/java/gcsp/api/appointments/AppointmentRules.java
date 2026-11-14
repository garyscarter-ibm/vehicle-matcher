package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The one validation of the appointment assumption rows, shared by every policy source: no defaults, any gap is unavailable. */
final class AppointmentRules {

    static final String SLOTS = "lifecycle.appointments.slots.v1";
    static final String CONFIRMATION = "lifecycle.appointments.confirmation.v1";
    static final String SCENARIO = "lifecycle.appointments.scenario.v1";
    static final String OWNERSHIP = "lifecycle.appointments.ownership.v1";
    static final String OUTCOMES = "lifecycle.appointments.outcomes.v1";
    static final String OUTCOME_TIMING = "lifecycle.appointments.outcomeTiming.v1";
    private static final Set<String> OWNERS = Set.of("employee", "retailer", "scheme-team");
    private static final List<String> STATES = List.of("not-requested", "requested", "change-proposed", "scheduled");
    private static final List<String> OUTCOME_STATES = List.of("completed", "no-show");
    private static final Set<String> STATUSES = Set.of("assumed", "verified");

    /** The one row in force for a key at the pinned version, or null when absent, repeated or not in force. */
    interface Rows {
        JsonNode row(String key);
    }

    private AppointmentRules() {}

    static PolicyResult<AppointmentConfig> config(String policyVersion, Rows rows) {
        List<JsonNode> found = new ArrayList<>();
        for (String key : List.of(SLOTS, CONFIRMATION, SCENARIO, OWNERSHIP, OUTCOMES)) {
            JsonNode row = rows.row(key);
            if (!usable(row, policyVersion) || !text(row.get("basis"), 2000) || !text(row.get("unit"), 200)
                    || !row.path("status").isTextual() || !STATUSES.contains(row.get("status").asText())) {
                return PolicyResult.unavailable();
            }
            found.add(row);
        }
        JsonNode slots = found.get(0).get("value");
        JsonNode confirmation = found.get(1).get("value");
        JsonNode scenario = found.get(2).get("value");
        JsonNode ownership = found.get(3).get("value");
        JsonNode outcomes = found.get(4).get("value");

        SlotPolicy slotPolicy = slotPolicy(slots);
        if (slotPolicy == null || !text(slots.get("openingStage"), 128)
                || !"approved".equals(slots.path("openingState").asText(null))) return PolicyResult.unavailable();
        if (!Values.object(confirmation) || !Values.integerIn(confirmation.get("confirmDelaySeconds"), 0, 30L * 86400)
                || !Values.integerIn(confirmation.get("providerTimeoutMs"), 1, 60000)) return PolicyResult.unavailable();
        if (!Values.object(scenario) || !scenario.path("proposeChange").isBoolean()
                || !"next-offered".equals(scenario.path("proposedSlot").asText(null))
                || !text(scenario.get("proposalReason"), 200)) return PolicyResult.unavailable();
        AppointmentConfig.Ownership owned = ownership(ownership);
        AppointmentConfig.Outcomes outcome = outcomes(outcomes);
        if (owned == null || outcome == null) return PolicyResult.unavailable();

        List<AppointmentConfig.Assumption> shown = new ArrayList<>();
        for (JsonNode row : found) {
            shown.add(new AppointmentConfig.Assumption(row.path("key").asText(), row.path("status").asText(),
                    row.path("unit").asText(), row.path("basis").asText(), row.path("source").asText(null),
                    row.path("sourceDate").asText(null), row.path("policyVersion").asText()));
        }
        return new PolicyResult.Ok<>(new AppointmentConfig(policyVersion, slots.get("openingStage").asText(),
                slots.get("openingState").asText(), slotPolicy, Values.integer(confirmation.get("confirmDelaySeconds")).intValue(),
                Values.integer(confirmation.get("providerTimeoutMs")).intValue(),
                new AppointmentConfig.Scenario(scenario.get("proposeChange").asBoolean(),
                        scenario.get("proposedSlot").asText(), scenario.get("proposalReason").asText()),
                owned, outcome, shown));
    }

    static PolicyResult<OutcomeTiming> timing(String policyVersion, Rows rows) {
        JsonNode row = rows.row(OUTCOME_TIMING);
        if (!usable(row, policyVersion) || !row.path("status").isTextual() || !STATUSES.contains(row.get("status").asText())) {
            return PolicyResult.unavailable();
        }
        JsonNode v = row.get("value");
        AppointmentConfig.Step tooEarly = Values.object(v) ? step(v.get("tooEarly")) : null;
        if (!Values.object(v) || !Values.integerIn(v.get("completeAfterSlotStartSeconds"), 0, 86400)
                || !Values.integerIn(v.get("noShowAfterSlotStartSeconds"), 0, 86400) || tooEarly == null) {
            return PolicyResult.unavailable();
        }
        return new PolicyResult.Ok<>(new OutcomeTiming(Values.integer(v.get("completeAfterSlotStartSeconds")).intValue(),
                Values.integer(v.get("noShowAfterSlotStartSeconds")).intValue(), tooEarly));
    }

    /** A row at the pinned version that carries a value. */
    private static boolean usable(JsonNode row, String policyVersion) {
        return row != null && row.has("value") && !row.get("value").isNull()
                && policyVersion.equals(row.path("policyVersion").asText(null));
    }

    private static SlotPolicy slotPolicy(JsonNode slots) {
        if (!Values.object(slots) || !Values.integerIn(slots.get("earliestLeadDays"), 0, 60)
                || !Values.integerIn(slots.get("daysOffered"), 1, 14) || !Values.integerIn(slots.get("slotMinutes"), 5, 480)
                || !slots.path("dailyStartTimes").isArray() || slots.get("dailyStartTimes").isEmpty()) return null;
        List<String> times = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode t : slots.get("dailyStartTimes")) {
            if (!t.isTextual() || !SlotPolicy.HHMM.matcher(t.asText()).matches() || !seen.add(t.asText())) return null;
            times.add(t.asText());
        }
        return new SlotPolicy(Values.integer(slots.get("earliestLeadDays")).intValue(),
                Values.integer(slots.get("daysOffered")).intValue(), Values.integer(slots.get("slotMinutes")).intValue(), times);
    }

    private static AppointmentConfig.Ownership ownership(JsonNode o) {
        if (!Values.object(o) || !Values.object(o.get("states"))) return null;
        Map<String, AppointmentConfig.Step> states = new LinkedHashMap<>();
        for (String s : STATES) {
            AppointmentConfig.Step step = step(o.get("states").get(s));
            if (step == null) return null;
            states.put(s, step);
        }
        AppointmentConfig.Step ineligible = step(o.get("ineligible"));
        AppointmentConfig.Step pending = step(o.get("pending"));
        AppointmentConfig.Step blocked = step(o.get("blocked"));
        return ineligible == null || pending == null || blocked == null ? null
                : new AppointmentConfig.Ownership(states, ineligible, pending, blocked);
    }

    private static AppointmentConfig.Outcomes outcomes(JsonNode o) {
        if (!Values.object(o) || !Values.object(o.get("states")) || !Values.object(o.get("exceptionTypes"))
                || !text(o.get("exceptionTypes").get("noShow"), 128)) return null;
        Map<String, AppointmentConfig.Step> states = new LinkedHashMap<>();
        for (String s : OUTCOME_STATES) {
            AppointmentConfig.Step step = step(o.get("states").get(s));
            if (step == null) return null;
            states.put(s, step);
        }
        AppointmentConfig.Step notReady = step(o.get("notReady"));
        return notReady == null ? null : new AppointmentConfig.Outcomes(states, notReady);
    }

    private static AppointmentConfig.Step step(JsonNode n) {
        if (!Values.object(n) || !n.path("owner").isTextual() || !OWNERS.contains(n.get("owner").asText())
                || !text(n.get("nextStep"), 200)) return null;
        return new AppointmentConfig.Step(n.get("owner").asText(), n.get("nextStep").asText());
    }

    private static boolean text(JsonNode n, int max) {
        return Values.text(n, max);
    }
}
