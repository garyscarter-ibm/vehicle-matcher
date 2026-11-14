package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Reads the retained Node policy file format and validates like Node loadAppointmentPolicy and loadOutcomeTiming. */
public final class RetainedFileAppointmentPolicy implements AppointmentPolicy {

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
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Path file;
    private volatile JsonNode cached;

    public RetainedFileAppointmentPolicy(Path file) {
        this.file = file;
    }

    @Override
    public PolicyResult<AppointmentConfig> config(String policyVersion, Instant asOf) {
        JsonNode root = open(policyVersion, asOf);
        if (root == null) return PolicyResult.unavailable();
        List<JsonNode> rows = new ArrayList<>();
        for (String key : List.of(SLOTS, CONFIRMATION, SCENARIO, OWNERSHIP, OUTCOMES)) {
            JsonNode row = row(root, key, policyVersion, asOf);
            if (row == null || !text(row.get("basis"), 2000) || !text(row.get("unit"), 200)
                    || !row.path("status").isTextual() || !STATUSES.contains(row.get("status").asText())) {
                return PolicyResult.unavailable();
            }
            rows.add(row);
        }
        JsonNode slots = rows.get(0).get("value");
        JsonNode confirmation = rows.get(1).get("value");
        JsonNode scenario = rows.get(2).get("value");
        JsonNode ownership = rows.get(3).get("value");
        JsonNode outcomes = rows.get(4).get("value");

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
        for (JsonNode row : rows) {
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

    @Override
    public PolicyResult<OutcomeTiming> timing(String policyVersion, Instant asOf) {
        JsonNode root = open(policyVersion, asOf);
        if (root == null) return PolicyResult.unavailable();
        JsonNode row = row(root, OUTCOME_TIMING, policyVersion, asOf);
        if (row == null || !row.path("status").isTextual() || !STATUSES.contains(row.get("status").asText())) {
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

    /** The parsed file when it is one version, already in force at asOf, and matches the pinned version. */
    private JsonNode open(String policyVersion, Instant asOf) {
        if (policyVersion == null || asOf == null) return null;
        JsonNode root = cached;
        if (root == null) {
            // A retained file is immutable once deployed, so it is parsed once, not per request or tick.
            try {
                root = JSON.readTree(Files.readString(file));
            } catch (IOException | RuntimeException e) {
                return null;
            }
            cached = root;
        }
        if (root == null || !root.path("policyVersion").isTextual() || !policyVersion.equals(root.get("policyVersion").asText())
                || !effective(root, asOf) || !root.path("assumptions").isArray()) return null;
        return root;
    }

    private static boolean effective(JsonNode node, Instant asOf) {
        Instant from = Iso.parse(node.path("effectiveFrom").asText(null));
        if (from == null || from.isAfter(asOf)) return false;
        if (!node.has("effectiveTo")) return true;
        Instant to = Iso.parse(node.get("effectiveTo").asText(null));
        return to != null && to.isAfter(from) && to.isAfter(asOf);
    }

    /** The one row for the key at the pinned version and instant; null when absent, repeated or not in force. */
    private static JsonNode row(JsonNode root, String key, String version, Instant asOf) {
        JsonNode found = null;
        for (JsonNode row : root.get("assumptions")) {
            if (!key.equals(row.path("key").asText(null))) continue;
            if (found != null) return null;
            found = row;
        }
        if (found == null || !version.equals(found.path("policyVersion").asText(null))) return null;
        boolean inForce = !found.has("effectiveFrom") && !found.has("effectiveTo") || effectiveRow(found, asOf);
        return inForce && found.has("value") && !found.get("value").isNull() ? found : null;
    }

    private static boolean effectiveRow(JsonNode row, Instant asOf) {
        if (row.has("effectiveFrom")) {
            Instant from = Iso.parse(row.get("effectiveFrom").asText(null));
            if (from == null || from.isAfter(asOf)) return false;
        }
        if (row.has("effectiveTo")) {
            Instant to = Iso.parse(row.get("effectiveTo").asText(null));
            return to != null && to.isAfter(asOf);
        }
        return true;
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
