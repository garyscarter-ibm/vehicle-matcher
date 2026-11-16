package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** The clock's policy entries read together at one instant from one policy version; never a default. */
public record ClockConfiguration(String policyVersion, String scenarioVersion, String fixtureVersion, Instant startsAt,
        Map<String, Instant> namedTimes, long initialClockVersion, List<String> stages, List<String> startupStages,
        long stepSeconds) {

    static final String SCENARIO = "clock.scenario.v1";
    static final String COMMANDS = "clock.commands.v1";
    static final String STAGES = "clock.handler.order.v1";
    static final String STEP = "clock.presenter.stepSeconds";

    private static final Pattern VERSION = Pattern.compile("^[1-9][0-9]*$");
    private static final long MAX_SAFE = 9_007_199_254_740_991L;

    /** The configuration, or the reason it is unavailable. */
    public record Loaded(ClockConfiguration configuration, String problem) {
        public boolean ok() {
            return configuration != null;
        }
    }

    public static Loaded read(PolicyService policy, String runId, Instant asOf) {
        try {
            PolicyRead read = new PolicyRead(runId, Instants.format(asOf), null);
            Map<String, JsonNode> rows = new LinkedHashMap<>();
            String version = null;
            for (String key : List.of(SCENARIO, COMMANDS, STAGES, STEP)) {
                PolicyResult found = policy.getAssumption(key, read);
                if (!found.ok() || found.policyVersion() == null || found.value() == null) {
                    return problem("Policy entry " + key + " is not available.");
                }
                if (version != null && !version.equals(found.policyVersion())) {
                    return problem("The clock policy entries come from different policy versions.");
                }
                version = found.policyVersion();
                rows.put(key, found.value());
            }
            return build(version, rows);
        } catch (RuntimeException e) {
            return problem("The policy could not be read.");
        }
    }

    private static Loaded problem(String text) {
        return new Loaded(null, text);
    }

    private static Loaded build(String version, Map<String, JsonNode> rows) {
        JsonNode scenario = rows.get(SCENARIO).get("value");
        JsonNode commands = rows.get(COMMANDS).get("value");
        JsonNode stageRow = rows.get(STAGES).get("value");
        JsonNode stepRow = rows.get(STEP);
        List<String> stages = textList(stageRow);
        if (stages == null || stages.isEmpty() || new HashSet<>(stages).size() != stages.size()) {
            return problem("clock.handler.order.v1 must list unique, nonblank stages.");
        }
        if (scenario == null || !scenario.isObject() || !text(scenario.get("scenarioVersion"))
                || !text(scenario.get("fixtureVersion"))) {
            return problem("clock.scenario.v1 needs scenarioVersion and fixtureVersion text.");
        }
        Instant startsAt = instant(scenario.get("startsAt"));
        JsonNode named = scenario.get("namedTimes");
        if (startsAt == null || named == null || !named.isObject()) {
            return problem("clock.scenario.v1 needs a valid startsAt and namedTimes.");
        }
        Map<String, Instant> times = new LinkedHashMap<>();
        for (var it = named.fields(); it.hasNext();) {
            var entry = it.next();
            Instant at = instant(entry.getValue());
            if (at == null) return problem("clock.scenario.v1 namedTimes must all be valid instants.");
            times.put(entry.getKey(), at);
        }
        if (commands == null || !commands.isObject() || !commands.path("advanceAndTickSeparate").isBoolean()
                || !commands.get("advanceAndTickSeparate").booleanValue() || !commands.path("forwardOnly").isBoolean()
                || !commands.get("forwardOnly").booleanValue()) {
            return problem("clock.commands.v1 must keep advance and tick separate and forward only.");
        }
        JsonNode initial = commands.get("initialClockVersion");
        if (initial == null || !initial.isTextual() || !VERSION.matcher(initial.textValue()).matches()
                || initial.textValue().length() > 16 || Long.parseLong(initial.textValue()) > MAX_SAFE) {
            return problem("clock.commands.v1 needs a positive integer initialClockVersion.");
        }
        List<String> startup = textList(commands.get("startupStages"));
        if (startup == null || !stages.containsAll(startup)) {
            return problem("clock.commands.v1 startupStages must be defined stages.");
        }
        long step = step(stepRow);
        if (step <= 0) return problem("clock.presenter.stepSeconds needs a positive whole number of seconds.");
        return new Loaded(new ClockConfiguration(version, scenario.get("scenarioVersion").textValue(),
                scenario.get("fixtureVersion").textValue(), startsAt, times, Long.parseLong(initial.textValue()),
                List.copyOf(stages), List.copyOf(startup), step), null);
    }

    private static long step(JsonNode row) {
        JsonNode unit = row.get("unit");
        JsonNode value = row.get("value");
        boolean good = unit != null && unit.isTextual() && "seconds".equals(unit.textValue()) && value != null
                && value.isIntegralNumber() && value.canConvertToLong() && value.longValue() > 0
                && value.longValue() <= MAX_SAFE;
        return good ? value.longValue() : -1;
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && Instants.text(node.textValue(), 128);
    }

    private static Instant instant(JsonNode node) {
        return node != null && node.isTextual() ? Instants.parse(node.textValue()) : null;
    }

    private static List<String> textList(JsonNode node) {
        if (node == null || !node.isArray()) return null;
        List<String> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isTextual() || item.textValue().isBlank()) return null;
            out.add(item.textValue());
        }
        return out;
    }

    /** The stages a tick of this kind may run, in policy order. */
    List<String> stagesFor(TickKind kind) {
        return kind == TickKind.STARTUP ? startupStages : stages;
    }
}
