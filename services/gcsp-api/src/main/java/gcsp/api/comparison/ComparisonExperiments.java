package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.finite;
import static gcsp.api.comparison.ComparisonValidation.jsText;
import static gcsp.api.comparison.ComparisonValidation.safeInteger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Port of the Node experiment preparation: checks an experiment against PolicyService before any replay. */
public final class ComparisonExperiments {

    public static final String PROCESS_EXPERIMENT_ID = "process-only";
    public static final String PROCESS_COMPARISON_CAVEAT = "Calculated fit is not observed satisfaction.";
    public static final String EXPERIMENT_CAVEAT = PROCESS_COMPARISON_CAVEAT;
    public static final List<String> EXPERIMENT_IDS = List.of("process-only", "order-mix", "points", "hold-sweep");
    public static final String EXPERIMENTS_KEY = "comparison.experiments.v1";
    public static final String POINTS_KEY = "comparison.pointsAllowanceMultiplier";
    public static final String WHAT_IF_LIMITATION = "What-if experiment: the changed values were never published as live policy.";
    /** The policy key each what-if experiment changes. */
    public static final Map<String, String> EXPERIMENT_KEYS = Map.of("order-mix", "comparison.modelLineMix",
            "points", POINTS_KEY, "hold-sweep", "hold.buddy.durationSeconds");
    static final String PREPARATION_RUN = "comparison-experiment-preparation";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private ComparisonExperiments() {}

    /** One arm: the baseline, the process arm, or one changed value, with the overlay its inputs are generated from. */
    public record Arm(String armId, JsonNode value, ObjectNode overlay) {

        ObjectNode toJson() {
            ObjectNode out = JSON.objectNode();
            out.put("armId", armId);
            out.set("value", value);
            out.set("overlay", overlay);
            return out;
        }
    }

    /** The plan: { experimentId, seeds, arms, steps }. */
    public record Plan(String experimentId, ArrayNode seeds, List<Arm> arms, int steps) {

        public ObjectNode toJson() {
            ObjectNode out = JSON.objectNode();
            out.put("experimentId", experimentId);
            out.set("seeds", seeds);
            ArrayNode list = out.putArray("arms");
            arms.forEach(arm -> list.add(arm.toJson()));
            out.put("steps", steps);
            return out;
        }
    }

    /** The plan with everything a run needs; definitionRow and changeInfo are null for the process comparison. */
    public record Prepared(Plan plan, ComparisonPolicy snapshot, JsonNode ruleRow, JsonNode definitionRow,
            ObjectNode changeInfo, ObjectNode overlay, boolean scaled) {}

    private static ComparisonRunError refuse(String boundary) {
        return new ComparisonRunError("invalid-input", boundary);
    }

    private static boolean plain(JsonNode node) {
        return node != null && node.isObject();
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && jsText(node.textValue());
    }

    /** Reads one assumption row at the pinned policy version; anything but an ok, same-version row is refused. */
    static JsonNode assumption(PolicyService policy, String key, PolicyRead read) {
        PolicyResult result = policy.getAssumption(key, read);
        if (!result.ok()) throw new ComparisonRunError(result.status(), key);
        JsonNode row = result.value();
        boolean same = read.policyVersion().equals(result.policyVersion()) && row != null
                && row.get("policyVersion") != null && row.get("policyVersion").isTextual()
                && read.policyVersion().equals(row.get("policyVersion").textValue());
        if (!same) throw refuse(key);
        return row;
    }

    private static boolean sameValue(JsonNode a, JsonNode b) {
        return CanonicalJson.digest(a).equals(CanonicalJson.digest(b));
    }

    private static boolean distinct(JsonNode list) {
        Set<String> seen = new HashSet<>();
        int unique = 0;
        for (JsonNode item : list) {
            String key = item.isNumber() ? "n" + (item.doubleValue() + 0.0) : item.isTextual() ? "s" + item.textValue()
                    : item.isBoolean() ? "b" + item.booleanValue() : item.isNull() ? "null" : "o" + (unique++);
            seen.add(key);
        }
        return seen.size() == list.size();
    }

    private static boolean inRange(JsonNode value, double min, double max) {
        return finite(value) && value.doubleValue() >= min && value.doubleValue() <= max;
    }

    /** Checks an experiment before any replay; refuses with ComparisonRunError, or ComparisonInputError from the load. */
    public static Prepared prepare(JsonNode experiment, PolicyService policy, String nowIso) {
        JsonNode idNode = plain(experiment) ? experiment.get("experimentId") : null;
        String id = idNode != null && idNode.isTextual() ? idNode.textValue() : null;
        boolean process = PROCESS_EXPERIMENT_ID.equals(id);
        if (!plain(experiment) || id == null || !EXPERIMENT_IDS.contains(id)) throw refuse("experimentId");
        for (var names = experiment.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!(name.equals("experimentId") || name.equals("seeds") || name.equals("overlay")
                    || (!process && name.equals("change")))) throw refuse("experimentId");
        }
        if (experiment.get("overlay") != null && !plain(experiment.get("overlay"))) throw refuse("overlay");
        ObjectNode overlay = experiment.get("overlay") == null ? JSON.objectNode() : (ObjectNode) experiment.get("overlay");
        PolicyResult probe = policy.getAssumption("comparison.startsAt", new PolicyRead(PREPARATION_RUN, nowIso, null));
        if (!probe.ok()) throw new ComparisonRunError(probe.status(), "comparison.startsAt");
        ComparisonPolicy snapshot = ComparisonPolicy.load(policy,
                new PolicyRead(PREPARATION_RUN, probe.value().get("value").textValue(), null));
        JsonNode given = experiment.get("seeds");
        ArrayNode seeds = (given == null || given.isNull() ? snapshot.assumptions().get("comparison.seeds").get("value") : given)
                instanceof ArrayNode list ? list.deepCopy() : null;
        if (seeds == null || seeds.size() == 0 || !distinct(seeds)) throw refuse("seeds");
        PolicyRead read = new PolicyRead(PREPARATION_RUN,
                snapshot.assumptions().get("comparison.startsAt").get("value").textValue(), snapshot.policyVersion());
        JsonNode ruleRow = assumption(policy, ComparisonMeasures.RULE_KEY, read);
        if (process) {
            ObjectNode armOverlay = overlay.deepCopy();
            Plan plan = new Plan(id, seeds, List.of(new Arm("process", JSON.nullNode(), armOverlay)), seeds.size() * 2);
            return new Prepared(plan, snapshot, ruleRow, null, null, overlay, false);
        }

        JsonNode definitionRow = assumption(policy, EXPERIMENTS_KEY, read);
        JsonNode definitions = definitionRow.path("value");
        JsonNode definition = definitions.path("experiments").path(id);
        boolean sweep = id.equals("hold-sweep");
        boolean bounded = id.equals("order-mix") || (finite(definition.get("minimum")) && finite(definition.get("maximum"))
                && definition.get("minimum").doubleValue() <= definition.get("maximum").doubleValue());
        boolean limited = !sweep || (safeInteger(definition.get("maximumValues"))
                && definition.get("maximumValues").doubleValue() >= 1);
        String definitionKey = EXPERIMENT_KEYS.get(id);
        if (!(finite(definitions.get("schemaVersion")) && definitions.get("schemaVersion").doubleValue() == 1)
                || !plain(definition) || !(definition.get("key") != null && definition.get("key").isTextual()
                && definition.get("key").textValue().equals(definitionKey)) || !text(definition.get("unit"))
                || !bounded || !limited) throw refuse(EXPERIMENTS_KEY);
        JsonNode baseline = snapshot.assumptions().get(definitionKey);
        if (baseline == null || baseline.get("unit") == null || !baseline.get("unit").equals(definition.get("unit"))) {
            throw refuse(definitionKey);
        }
        if (overlay.has(definitionKey)) throw refuse("overlay");

        JsonNode change = experiment.get("change");
        String field = sweep ? "values" : "value";
        if (!plain(change)) throw refuse("change");
        for (var names = change.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!name.equals("basis") && !name.equals(field)) throw refuse("change");
        }
        if (!change.has(field)) throw refuse("change");
        if (!text(change.get("basis"))) throw refuse("basis");
        JsonNode values = sweep ? change.get("values") : JSON.arrayNode().add(change.get("value"));
        if (!values.isArray()) throw refuse("change");
        if (sweep) {
            boolean whole = values.size() >= 1 && values.size() <= definition.get("maximumValues").doubleValue()
                    && distinct(values);
            if (whole) for (JsonNode item : values) whole &= safeInteger(item);
            if (!whole) throw refuse("change");
        }
        for (JsonNode value : values) {
            if (!id.equals("order-mix") && !inRange(value, definition.get("minimum").doubleValue(),
                    definition.get("maximum").doubleValue())) throw refuse(definitionKey);
            if (sameValue(value, baseline.get("value"))) throw refuse(definitionKey);
        }

        List<Arm> arms = new ArrayList<>();
        arms.add(new Arm("baseline", baseline.get("value").deepCopy(), overlay.deepCopy()));
        for (JsonNode value : values) {
            ObjectNode armOverlay = overlay.deepCopy();
            armOverlay.set(definitionKey, value.deepCopy());
            String armId = sweep ? "hold-" + (long) value.doubleValue() : "variant";
            arms.add(new Arm(armId, value.deepCopy(), armOverlay));
        }
        // Generate once per arm that is not a hold change, so a bad mix or overlay is refused before any replay.
        for (Arm arm : sweep ? arms.subList(0, 1) : arms) {
            try {
                ComparisonInputs.generate(seeds.get(0), snapshot, arm.overlay());
            } catch (ComparisonInputError error) {
                throw refuse(error.key() == null ? "overlay" : error.key());
            }
        }
        Plan plan = new Plan(id, seeds, arms, arms.size() * seeds.size() * 2);
        ObjectNode info = JSON.objectNode();
        info.put("key", definitionKey);
        info.set("unit", definition.get("unit").deepCopy());
        info.put("status", "what-if");
        info.put("basis", ComparisonValidation.jsTrim(change.get("basis").textValue()));
        info.set("baselineValue", baseline.get("value").deepCopy());
        if (baseline.get("basis") != null) info.set("baselineBasis", baseline.get("basis").deepCopy());
        if (baseline.get("status") != null) info.set("baselineStatus", baseline.get("status").deepCopy());
        info.put("definitionKey", EXPERIMENTS_KEY);
        if (sweep) info.set("values", values.deepCopy()); else info.set("value", values.get(0).deepCopy());
        return new Prepared(plan, snapshot, ruleRow, definitionRow, info, overlay, true);
    }
}
