package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Reads the retained Node policy file (policyVersion, effectiveFrom, assumptions[]) and applies the validation of
 * return-plan/policy.js and appointments/policy.js. A read is pinned to one version; any gap is unavailable.
 */
public final class RetainedReturnPolicy implements ReturnPolicyPort {

    public static final String OPTIONS = "lifecycle.return.options.v1";
    public static final String OWNERSHIP = "lifecycle.return.ownership.v1";
    public static final String OUTCOME = "lifecycle.return.outcome.v1";
    public static final String SLOTS = "lifecycle.appointments.slots.v1";
    public static final String CONFIRMATION = "lifecycle.appointments.confirmation.v1";
    public static final String SCENARIO = "lifecycle.appointments.scenario.v1";

    private static final List<String> STATES = List.of("not-requested", "requested", "change-proposed", "scheduled");
    private static final Set<String> HANDOVER_STATES =
            Set.of("not-requested", "requested", "change-proposed", "scheduled", "completed", "no-show");
    private static final Set<String> OWNERS = Set.of("employee", "retailer", "scheme-team");
    private static final Map<String, String> SLOT_RULE = Map.of("same-visit", "handover-slot", "separate", "after-handover");
    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");
    private static final long MONTH_SECONDS = 30L * 86400;

    private final Path file;

    public RetainedReturnPolicy(Path file) {
        this.file = file;
    }

    @Override
    public ReturnPolicyReading read(String runId, Instant asOf, String policyVersion) {
        try {
            ReturnPolicy policy = load(asOf, policyVersion);
            return policy == null ? ReturnPolicyReading.unavailable() : new ReturnPolicyReading.Ok(policy);
        } catch (IOException | RuntimeException e) {
            return ReturnPolicyReading.unavailable();
        }
    }

    private ReturnPolicy load(Instant asOf, String version) throws IOException {
        if (asOf == null || version == null || version.isEmpty()) return null;
        JsonNode root = ReturnJson.JSON.readTree(Files.readString(file));
        if (root == null || !version.equals(root.path("policyVersion").asText(null))) return null;
        Instant from = ReturnJson.parse(root.path("effectiveFrom").asText(null));
        if (from == null || from.isAfter(asOf)) return null;
        Row options = row(root, OPTIONS, version, asOf);
        Row slots = row(root, SLOTS, version, asOf);
        Row confirmation = row(root, CONFIRMATION, version, asOf);
        Row scenario = row(root, SCENARIO, version, asOf);
        Row ownership = row(root, OWNERSHIP, version, asOf);
        Row outcome = row(root, OUTCOME, version, asOf);
        if (options == null || slots == null || confirmation == null || scenario == null || ownership == null
                || outcome == null) {
            return null;
        }
        List<ReturnPolicy.Choice> choices = new ArrayList<>();
        Map<String, ReturnPolicy.Rule> rules = new LinkedHashMap<>();
        if (!options(options.value, choices, rules)) return null;
        JsonNode s = slots.value;
        if (!s.isObject() || !ReturnJson.text(s.path("openingStage").asText(null), 128)
                || !"approved".equals(s.path("openingState").asText(null))) {
            return null;
        }
        SlotPolicy slotPolicy = slotPolicy(s, 60, 14);
        JsonNode c = confirmation.value;
        if (slotPolicy == null || !c.isObject() || !range(c.path("confirmDelaySeconds"), 0, MONTH_SECONDS)
                || !range(c.path("providerTimeoutMs"), 1, 60000)) {
            return null;
        }
        JsonNode sc = scenario.value;
        if (!sc.isObject() || !sc.path("proposeChange").isBoolean()
                || !"next-offered".equals(sc.path("proposedSlot").asText(null))
                || !ReturnJson.text(sc.path("proposalReason").asText(null), 200)) {
            return null;
        }
        ReturnPolicy.Ownership own = ownership(ownership.value);
        ReturnPolicy.OutcomeConfig out = outcome(outcome.value);
        if (own == null || out == null) return null;
        List<ReturnPolicy.Assumption> provenance = new ArrayList<>();
        for (Row r : new Row[] {options, slots, confirmation, scenario, ownership, outcome}) provenance.add(r.assumption);
        return new ReturnPolicy(version, List.copyOf(choices), Map.copyOf(rules), own,
                s.get("openingStage").asText(), s.get("openingState").asText(), slotPolicy,
                c.get("confirmDelaySeconds").asInt(), c.get("providerTimeoutMs").asInt(),
                new ReturnPolicy.Scenario(sc.get("proposeChange").asBoolean(), "next-offered",
                        sc.get("proposalReason").asText()),
                out, List.copyOf(provenance));
    }

    private record Row(JsonNode value, ReturnPolicy.Assumption assumption) {}

    /** The row of exactly this version and key that is effective now and carries its basis, unit and status. */
    private static Row row(JsonNode root, String key, String version, Instant asOf) {
        JsonNode rows = root.path("assumptions");
        if (!rows.isArray()) return null;
        for (JsonNode r : rows) {
            if (!key.equals(r.path("key").asText(null)) || !version.equals(r.path("policyVersion").asText(null))) continue;
            if (r.has("effectiveFrom")) {
                Instant from = ReturnJson.parse(r.get("effectiveFrom").asText(null));
                if (from == null || from.isAfter(asOf)) return null;
            }
            if (r.has("effectiveTo")) {
                Instant to = ReturnJson.parse(r.get("effectiveTo").asText(null));
                if (to == null || !to.isAfter(asOf)) return null;
            }
            String status = r.path("status").asText(null);
            if (!ReturnJson.text(r.path("basis").asText(null), 2000) || !ReturnJson.text(r.path("unit").asText(null), 200)
                    || !("assumed".equals(status) || "verified".equals(status)) || !r.path("value").isObject()) {
                return null;
            }
            return new Row(r.get("value"), new ReturnPolicy.Assumption(key, status, r.get("unit").asText(),
                    r.get("basis").asText(), r.path("source").asText(null), r.path("sourceDate").asText(null), version));
        }
        return null;
    }

    private static boolean options(JsonNode v, List<ReturnPolicy.Choice> choices, Map<String, ReturnPolicy.Rule> rules) {
        if (!v.path("choices").isArray() || v.get("choices").isEmpty() || !v.path("rules").isObject()) return false;
        for (JsonNode ch : v.get("choices")) {
            String id = ch.path("id").asText(null);
            if (!ch.isObject() || !SLOT_RULE.containsKey(id) || !ReturnJson.text(ch.path("label").asText(null), 200)
                    || choices.stream().anyMatch(x -> x.id().equals(id))) {
                return false;
            }
            choices.add(new ReturnPolicy.Choice(id, ch.get("label").asText()));
        }
        if (v.get("rules").size() != choices.size()) return false;
        for (ReturnPolicy.Choice ch : choices) {
            ReturnPolicy.Rule rule = rule(ch.id(), v.get("rules").get(ch.id()));
            if (rule == null) return false;
            rules.put(ch.id(), rule);
        }
        return true;
    }

    private static ReturnPolicy.Rule rule(String id, JsonNode r) {
        if (r == null || !r.isObject() || !r.path("requiresHandoverStates").isArray() || r.get("requiresHandoverStates").isEmpty()
                || !"handover-retailer".equals(r.path("location").asText(null))
                || !SLOT_RULE.get(id).equals(r.path("slot").asText(null))) {
            return null;
        }
        List<String> states = new ArrayList<>();
        for (JsonNode s : r.get("requiresHandoverStates")) {
            if (!s.isTextual() || !HANDOVER_STATES.contains(s.asText())) return null;
            states.add(s.asText());
        }
        if ("same-visit".equals(id)) {
            return new ReturnPolicy.Rule(states, "handover-retailer", "handover-slot", false, 0, null);
        }
        SlotPolicy slots = slotPolicy(r.path("slots"), 60, 30);
        if (slots == null || !r.path("notBeforeHandoverEnd").isBoolean() || !range(r.path("maxDaysAfterHandover"), 1, 60)) {
            return null;
        }
        return new ReturnPolicy.Rule(states, "handover-retailer", "after-handover",
                r.get("notBeforeHandoverEnd").asBoolean(), r.get("maxDaysAfterHandover").asInt(), slots);
    }

    private static SlotPolicy slotPolicy(JsonNode s, int maxLead, int maxDays) {
        if (!s.isObject() || !range(s.path("earliestLeadDays"), 0, maxLead) || !range(s.path("daysOffered"), 1, maxDays)
                || !range(s.path("slotMinutes"), 5, 480) || !s.path("dailyStartTimes").isArray()
                || s.get("dailyStartTimes").isEmpty()) {
            return null;
        }
        List<String> times = new ArrayList<>();
        for (JsonNode t : s.get("dailyStartTimes")) {
            if (!t.isTextual() || !TIME.matcher(t.asText()).matches() || times.contains(t.asText())) return null;
            times.add(t.asText());
        }
        return new SlotPolicy(s.get("earliestLeadDays").asInt(), s.get("daysOffered").asInt(),
                s.get("slotMinutes").asInt(), times);
    }

    private static ReturnPolicy.Ownership ownership(JsonNode o) {
        if (!o.isObject() || !o.path("states").isObject()) return null;
        Map<String, ReturnPolicy.OwnerStep> states = new LinkedHashMap<>();
        for (String s : STATES) {
            ReturnPolicy.OwnerStep step = step(o.get("states").get(s));
            if (step == null) return null;
            states.put(s, step);
        }
        ReturnPolicy.OwnerStep ineligible = step(o.get("ineligible"));
        ReturnPolicy.OwnerStep pending = step(o.get("pending"));
        ReturnPolicy.OwnerStep blocked = step(o.get("blocked"));
        if (ineligible == null || pending == null || blocked == null) return null;
        return new ReturnPolicy.Ownership(Map.copyOf(states), ineligible, pending, blocked);
    }

    private static ReturnPolicy.OutcomeConfig outcome(JsonNode v) {
        if (!v.isObject() || !v.path("enabled").isBoolean() || !v.path("ownership").isObject()
                || !("returned".equals(v.path("outcome").asText(null)) || "missed".equals(v.path("outcome").asText(null)))
                || !range(v.path("delaySecondsAfterSlotEnd"), 0, MONTH_SECONDS)
                || !ReturnJson.text(v.path("exceptionType").asText(null), 128)) {
            return null;
        }
        ReturnPolicy.OwnerStep returned = step(v.get("ownership").get("returned"));
        ReturnPolicy.OwnerStep missed = step(v.get("ownership").get("missed"));
        if (returned == null || missed == null) return null;
        return new ReturnPolicy.OutcomeConfig(v.get("enabled").asBoolean(), v.get("outcome").asText(),
                v.get("delaySecondsAfterSlotEnd").asInt(), v.get("exceptionType").asText(), returned, missed);
    }

    private static ReturnPolicy.OwnerStep step(JsonNode s) {
        if (s == null || !s.isObject() || !OWNERS.contains(s.path("owner").asText(null))
                || !ReturnJson.text(s.path("nextStep").asText(null), 200)) {
            return null;
        }
        return new ReturnPolicy.OwnerStep(s.get("owner").asText(), s.get("nextStep").asText());
    }

    private static boolean range(JsonNode n, long min, long max) {
        return n != null && n.isIntegralNumber() && n.canConvertToLong() && n.asLong() >= min && n.asLong() <= max;
    }
}
