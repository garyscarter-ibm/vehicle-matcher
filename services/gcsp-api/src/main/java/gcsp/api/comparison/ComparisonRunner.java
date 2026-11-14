package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.strictEq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.comparison.ComparisonExperiments.Arm;
import gcsp.api.comparison.ComparisonExperiments.Plan;
import gcsp.api.comparison.ComparisonExperiments.Prepared;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/** Port of the Node replayArms and runComparison: seeds, then arms, then routes, then the frozen result object. */
public final class ComparisonRunner {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final List<String> ROUTES = List.of("current", "buddy");
    private static final List<String> ASSUMPTION_FIELDS = List.of("key", "value", "unit", "status", "basis", "source", "policyVersion");

    private ComparisonRunner() {}

    /** One finished step: { experimentId, armId, seed, route, completed, total }. */
    public record Progress(String experimentId, String armId, JsonNode seed, String route, int completed, int total) {

        public ObjectNode toJson() {
            ObjectNode out = JSON.objectNode();
            out.put("experimentId", experimentId);
            out.put("armId", armId);
            out.set("seed", seed);
            out.put("route", route);
            out.put("completed", completed);
            out.put("total", total);
            return out;
        }
    }

    /** Called after each step finishes. */
    @FunctionalInterface
    public interface ProgressListener {
        void step(Progress progress);
    }

    private record ArmResult(ArrayNode perSeed, Map<String, ObjectNode> assumptions) {}

    /** A route record's digest over its content; the code revision is provenance and stays out. */
    public static String outcomeRecordDigest(JsonNode record) {
        ObjectNode content = record.deepCopy();
        content.remove("codeRevision");
        return CanonicalJson.digest(content);
    }

    private static ObjectNode assumptionRow(JsonNode row) {
        ObjectNode out = JSON.objectNode();
        for (String name : ASSUMPTION_FIELDS) if (row.get(name) != null) out.set(name, row.get(name).deepCopy());
        return out;
    }

    private static ObjectNode ruleView(JsonNode row) {
        ObjectNode out = JSON.objectNode();
        for (String name : List.of("key", "value", "status", "basis", "source", "policyVersion")) {
            if (row.get(name) != null) out.set(name, row.get(name).deepCopy());
        }
        return out;
    }

    private static double multiplier(Prepared prepared, Arm arm) {
        if (!prepared.scaled()) return 1;
        JsonNode own = arm.overlay().get(ComparisonExperiments.POINTS_KEY);
        JsonNode value = own != null ? own : prepared.snapshot().assumptions().get(ComparisonExperiments.POINTS_KEY).get("value");
        return value.doubleValue();
    }

    private static ComparisonRunError refuse(String boundary) {
        return new ComparisonRunError("invalid-input", boundary);
    }

    // The per-seed evaluation cache is an optimisation inside the Node replay; a replay port may add its own.
    private static Object[] replayArms(Prepared prepared, ComparisonReplay replay, PolicyService policy, String codeRevision,
            ProgressListener progress) {
        Plan plan = prepared.plan();
        List<ArmResult> results = new ArrayList<>();
        for (int i = 0; i < plan.arms().size(); i++) results.add(new ArmResult(JSON.arrayNode(), new LinkedHashMap<>()));
        Set<String> limitations = new LinkedHashSet<>();
        String[] identity = null;
        int completed = 0;
        for (JsonNode seed : plan.seeds()) {
            for (int index = 0; index < plan.arms().size(); index++) {
                Arm arm = plan.arms().get(index);
                ComparisonInputs inputs = ComparisonInputs.generate(seed, prepared.snapshot(), arm.overlay());
                ObjectNode manifest = inputs.manifest();
                String[] seen = { manifest.get("policyVersion").textValue(), manifest.get("policyHash").textValue(),
                    manifest.get("generatorVersion").textValue() };
                if (identity == null) identity = seen;
                for (int k = 0; k < 3; k++) if (!identity[k].equals(seen[k])) throw refuse("manifest");
                ObjectNode routes = JSON.objectNode();
                for (String route : ROUTES) {
                    JsonNode record = replay.replay(new ComparisonReplay.Request(arm, route, seed, inputs, prepared.snapshot(),
                            policy, multiplier(prepared, arm), codeRevision));
                    if (record == null || !route.equals(textOf(record.get("route"))) || !strictEq(record.get("seed"), seed)
                            || !manifest.get("inputHash").textValue().equals(textOf(record.get("inputHash")))
                            || !manifest.get("policyVersion").textValue().equals(textOf(record.get("policyVersion")))) {
                        throw refuse("outcome-record");
                    }
                    Map<String, ObjectNode> assumptions = results.get(index).assumptions();
                    for (JsonNode row : record.get("assumptions")) {
                        assumptions.putIfAbsent(row.get("key").textValue(), assumptionRow(row));
                    }
                    for (JsonNode line : record.get("limitations")) limitations.add(line.textValue());
                    ObjectNode entry = routes.putObject(route);
                    entry.set("measures", ComparisonMeasures.routeMeasures(record));
                    entry.set("totals", record.get("totals").deepCopy());
                    entry.put("recordDigest", outcomeRecordDigest(record));
                    completed++;
                    if (progress != null) progress.step(new Progress(plan.experimentId(), arm.armId(), seed, route, completed, plan.steps()));
                }
                ObjectNode perSeed = JSON.objectNode();
                perSeed.set("seed", seed.deepCopy());
                perSeed.put("inputHash", manifest.get("inputHash").textValue());
                perSeed.set("routes", routes);
                results.get(index).perSeed().add(perSeed);
            }
        }
        return new Object[] { results, limitations, identity };
    }

    private static String textOf(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    private static ArrayNode routeDifferences(JsonNode perSeed, JsonNode ruleRow) {
        ArrayNode rows = JSON.arrayNode();
        for (JsonNode entry : perSeed) {
            ObjectNode row = rows.addObject();
            row.set("seed", entry.get("seed"));
            row.set("current", entry.get("routes").get("current").get("measures"));
            row.set("buddy", entry.get("routes").get("buddy").get("measures"));
        }
        return ComparisonMeasures.compareRoutes(rows, ruleRow);
    }

    private static ObjectNode armSummary(ObjectNode out, JsonNode perSeed, JsonNode ruleRow) {
        out.set("perSeed", perSeed);
        ObjectNode measures = out.putObject("measures");
        measures.set("current", ComparisonMeasures.routeSummary(perSeed, "current"));
        measures.set("buddy", ComparisonMeasures.routeSummary(perSeed, "buddy"));
        out.set("differences", routeDifferences(perSeed, ruleRow));
        return out;
    }

    private static ObjectNode inputHashes(JsonNode perSeed) {
        ObjectNode out = JSON.objectNode();
        for (JsonNode entry : perSeed) out.set(entry.get("seed").asText(), entry.get("inputHash"));
        return out;
    }

    private static ArrayNode sortedAssumptions(Map<String, ObjectNode> assumptions) {
        List<ObjectNode> rows = new ArrayList<>(assumptions.values());
        rows.sort((a, b) -> a.get("key").textValue().compareTo(b.get("key").textValue()));
        ArrayNode out = JSON.arrayNode();
        rows.forEach(out::add);
        return out;
    }

    private static void put(ObjectNode node, String name, String value) {
        if (value != null) node.put(name, value);
    }

    /** Runs process-only or a what-if; throws ComparisonRunError, ComparisonUnavailable or what the replay throws. */
    @SuppressWarnings("unchecked")
    public static ObjectNode run(JsonNode experiment, PolicyService policy, ComparisonReplay replay, String codeRevision,
            Supplier<String> now, ProgressListener progress) {
        Prepared prepared = ComparisonExperiments.prepare(experiment, policy, now.get());
        Object[] replayed = replayArms(prepared, replay, policy, codeRevision, progress);
        List<ArmResult> results = (List<ArmResult>) replayed[0];
        Set<String> limitations = (Set<String>) replayed[1];
        String[] identity = (String[]) replayed[2];
        Plan plan = prepared.plan();
        ObjectNode out = JSON.objectNode();
        out.put("schemaVersion", 1);
        if (plan.experimentId().equals(ComparisonExperiments.PROCESS_EXPERIMENT_ID)) {
            ArmResult only = results.get(0);
            only.assumptions().put(prepared.ruleRow().get("key").textValue(), assumptionRow(prepared.ruleRow()));
            out.put("kind", "process-comparison");
            out.put("experimentId", ComparisonExperiments.PROCESS_EXPERIMENT_ID);
            out.put("completedAt", now.get());
            ObjectNode manifest = out.putObject("manifest");
            manifest.put("experimentId", ComparisonExperiments.PROCESS_EXPERIMENT_ID);
            manifest.set("seeds", plan.seeds());
            identityInto(manifest, identity);
            manifest.set("overlays", prepared.overlay().deepCopy());
            put(manifest, "codeRevision", codeRevision);
            manifest.set("inputHashes", inputHashes(only.perSeed()));
            armSummary(out, only.perSeed(), prepared.ruleRow());
            // Node orders perSeed, measures, differences, then rule; armSummary wrote them in that order.
            out.set("rule", ruleView(prepared.ruleRow()));
            out.set("assumptions", sortedAssumptions(only.assumptions()));
            out.put("caveat", ComparisonExperiments.PROCESS_COMPARISON_CAVEAT);
            ArrayNode lines = out.putArray("limitations");
            limitations.forEach(lines::add);
            return out;
        }
        Map<String, ObjectNode> assumptions = new LinkedHashMap<>(results.get(0).assumptions());
        for (JsonNode row : List.of(prepared.ruleRow(), prepared.definitionRow())) {
            assumptions.put(row.get("key").textValue(), assumptionRow(row));
        }
        ArrayNode armResults = JSON.arrayNode();
        for (int index = 0; index < plan.arms().size(); index++) {
            Arm arm = plan.arms().get(index);
            ObjectNode armOut = armResults.addObject();
            armOut.put("armId", arm.armId());
            armOut.set("value", arm.value());
            armSummary(armOut, results.get(index).perSeed(), prepared.ruleRow());
        }
        ArrayNode effects = JSON.arrayNode();
        JsonNode baseline = results.get(0).perSeed();
        for (int offset = 0; offset < plan.arms().size() - 1; offset++) {
            Arm arm = plan.arms().get(offset + 1);
            ObjectNode effect = effects.addObject();
            effect.put("armId", arm.armId());
            effect.set("value", arm.value());
            ObjectNode routes = effect.putObject("routes");
            for (String route : ROUTES) {
                ArrayNode rows = JSON.arrayNode();
                for (int s = 0; s < baseline.size(); s++) {
                    ObjectNode row = rows.addObject();
                    row.set("seed", baseline.get(s).get("seed"));
                    row.set("baseline", baseline.get(s).get("routes").get(route).get("measures"));
                    row.set("variant", results.get(offset + 1).perSeed().get(s).get("routes").get(route).get("measures"));
                }
                routes.set(route, ComparisonMeasures.compareArms(rows, prepared.ruleRow()));
            }
        }
        out.put("kind", "experiment-comparison");
        out.put("experimentId", plan.experimentId());
        out.put("completedAt", now.get());
        ObjectNode manifest = out.putObject("manifest");
        manifest.put("experimentId", plan.experimentId());
        manifest.set("seeds", plan.seeds());
        identityInto(manifest, identity);
        manifest.set("overlays", prepared.overlay().deepCopy());
        put(manifest, "codeRevision", codeRevision);
        manifest.set("change", prepared.changeInfo());
        ArrayNode armManifests = manifest.putArray("arms");
        for (int index = 0; index < plan.arms().size(); index++) {
            Arm arm = plan.arms().get(index);
            ObjectNode row = armManifests.addObject();
            row.put("armId", arm.armId());
            row.set("value", arm.value());
            row.set("overlay", arm.overlay().deepCopy());
            row.put("overlayHash", CanonicalJson.digest(arm.overlay()));
            row.set("inputHashes", inputHashes(results.get(index).perSeed()));
        }
        out.set("arms", armResults);
        out.set("effects", effects);
        out.set("rule", ruleView(prepared.ruleRow()));
        out.set("assumptions", sortedAssumptions(assumptions));
        out.put("caveat", ComparisonExperiments.EXPERIMENT_CAVEAT);
        ArrayNode lines = out.putArray("limitations");
        limitations.forEach(lines::add);
        lines.add(ComparisonExperiments.WHAT_IF_LIMITATION);
        return out;
    }

    private static void identityInto(ObjectNode manifest, String[] identity) {
        manifest.put("policyVersion", identity[0]);
        manifest.put("policyHash", identity[1]);
        manifest.put("generatorVersion", identity[2]);
    }
}
