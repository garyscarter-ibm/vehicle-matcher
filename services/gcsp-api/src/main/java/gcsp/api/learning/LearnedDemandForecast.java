package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Port of createLearnedDemandForecastProvider (forecast/provider.js): a PredictionInput to a DemandForecast. */
@ApplicationScoped
public class LearnedDemandForecast implements LearnedDemandForecastPort {

    public static final String FORECAST_KEY = "forecast.learned.v1";
    public static final String MODEL_REFERENCE_KEY = ActiveChoiceModel.REFERENCE_KEY;
    public static final String LEARNED_BASIS = "synthetic-trained-model";
    public static final String LEARNED_LABEL = "Learned model";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final String BASE = "only the baseline plan from expressed demand is shown";
    private static final Map<String, String> LIMITATIONS = Map.of(
            "no-active-model", "No learned model is active, so " + BASE + ".",
            "artifact-missing", "The active model file could not be found, so " + BASE + ".",
            "artifact-invalid", "The active model file failed its checks, so " + BASE + ".",
            "outside-coverage", "Some employees or vehicle classes are outside what the model was trained on, so " + BASE + ".",
            "forecast-policy-unavailable", "The learned forecast settings are unavailable, so " + BASE + ".");

    /** The three numbers the policy row supplies. */
    record Settings(double choiceMassThreshold, double waitExclusionThreshold, double intervalZ) {}

    private final PolicyService policy;
    private final ModelArtifacts artifacts;

    @Inject
    public LearnedDemandForecast(PolicyService policy, LearningSelection selection) {
        this(policy, selection.artifacts());
    }

    public LearnedDemandForecast(PolicyService policy, ModelArtifacts artifacts) {
        this.policy = policy;
        this.artifacts = artifacts;
    }

    private static ObjectNode status(String status, String code) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.put("code", code);
        body.put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
        return body;
    }

    private static ObjectNode fallback(String reason, ObjectNode model, ObjectNode coverage, ObjectNode trained) {
        ObjectNode body = JSON.objectNode();
        body.put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
        body.put("status", "fallback");
        body.put("basis", "deterministic-baseline");
        body.put("reason", reason);
        body.put("limitation", LIMITATIONS.get(reason));
        if (model != null) body.set("model", model);
        if (coverage != null) body.set("coverage", coverage);
        if (trained != null) body.set("trained", trained);
        return body;
    }

    private static ObjectNode modelRef(String artifactId) {
        return JSON.objectNode().put("artifactId", artifactId);
    }

    private static boolean rate(JsonNode v) {
        return Js.finite(v) && v.doubleValue() >= 0 && v.doubleValue() <= 1;
    }

    private static Settings settingsOf(JsonNode value) {
        if (!Js.isObject(value) || !rate(value.get("choiceMassThreshold")) || !(value.get("choiceMassThreshold").doubleValue() > 0)
                || !rate(value.get("waitExclusionThreshold")) || !Js.finite(value.get("intervalZ"))
                || !(value.get("intervalZ").doubleValue() > 0) || value.get("intervalZ").doubleValue() > 10) return null;
        return new Settings(value.get("choiceMassThreshold").doubleValue(), value.get("waitExclusionThreshold").doubleValue(),
                value.get("intervalZ").doubleValue());
    }

    @Override
    public ObjectNode forecast(JsonNode input, PolicyRead policyRead) {
        if (!PredictionInputValidator.validate(input).isEmpty()) return status("invalid", "prediction-input-invalid");
        try {
            PolicyRead read = policyRead != null ? policyRead : new PolicyRead(input.get("runId").textValue(),
                    input.get("asOf").textValue(), input.get("policyVersion").textValue());
            PolicyResult reference = policy.getAssumption(MODEL_REFERENCE_KEY, read);
            JsonNode ref = reference.ok() ? Js.get(reference.value(), "value") : null;
            JsonNode id = Js.get(ref, "artifactId");
            if (!Js.isText(id) || !ModelArtifact.validId(id.textValue())) return fallback("no-active-model", null, null, null);
            String artifactId = id.textValue();
            String featureVersion = Js.isText(ref.get("featureVersion")) ? ref.get("featureVersion").textValue() : null;
            if (!Js.strictEquals(ref.get("schemaVersion"), JSON.numberNode(1)) || !ChoiceFeatures.known(featureVersion)) {
                return fallback("artifact-invalid", modelRef(artifactId), null, null);
            }
            if (!artifacts.exists(artifactId)) return fallback("artifact-missing", modelRef(artifactId), null, null);
            ActiveChoiceModel.Active active = ActiveChoiceModel.read(policy, read, artifacts);
            if (active == null) return fallback("artifact-invalid", modelRef(artifactId), null, null);
            ModelArtifact artifact = active.artifact();
            ObjectNode summary;
            try {
                summary = artifact.evaluationSummary();
            } catch (RuntimeException e) {
                return fallback("artifact-invalid", modelRef(artifactId), null, null);
            }
            PolicyResult row = policy.getAssumption(FORECAST_KEY, new PolicyRead(read.runId(), read.asOf(), active.policyVersion()));
            Settings settings = row.ok() && active.policyVersion().equals(row.policyVersion())
                    ? settingsOf(Js.get(row.value(), "value")) : null;
            if (settings == null) return fallback("forecast-policy-unavailable", modelRef(artifactId), null, null);
            ObjectNode trained = trainedCoverage(artifact.payload());
            JsonNode entitlements = input.get("cohort").get("entitlements");
            List<String> cohorts = new ArrayList<>();
            List<String> classes = new ArrayList<>();
            for (JsonNode e : entitlements) {
                cohorts.add(e.get("cohortKey").textValue());
                for (JsonNode c : e.get("permittedChoices")) classes.add(c.get("vehicleClass").textValue());
            }
            ArrayNode missingCohorts = uncovered(trained.get("cohorts"), cohorts);
            ArrayNode missingClasses = uncovered(trained.get("vehicleClasses"), classes);
            if (!missingCohorts.isEmpty() || !missingClasses.isEmpty()) {
                ObjectNode coverage = JSON.objectNode();
                coverage.set("cohorts", missingCohorts);
                coverage.set("vehicleClasses", missingClasses);
                return fallback("outside-coverage", modelRef(artifactId), coverage, trained);
            }
            return ok(input, artifact, active, settings, summary);
        } catch (RuntimeException e) {
            return status("unavailable", "learned-forecast-unavailable");
        }
    }

    private static ObjectNode ok(JsonNode input, ModelArtifact artifact, ActiveChoiceModel.Active active, Settings settings,
            ObjectNode summary) {
        ArrayNode employees = JSON.arrayNode();
        ArrayNode aggregate = JSON.arrayNode();
        score(input, artifact, settings, employees, aggregate);
        ObjectNode payload = artifact.payload();
        JsonNode manifest = payload.get("trainingManifest");
        ObjectNode settingsNode = JSON.objectNode();
        settingsNode.put("choiceMassThreshold", settings.choiceMassThreshold());
        settingsNode.put("waitExclusionThreshold", settings.waitExclusionThreshold());
        settingsNode.put("intervalZ", settings.intervalZ());
        ObjectNode digestInput = JSON.objectNode();
        digestInput.set("input", input);
        digestInput.put("artifactId", artifact.artifactId());
        digestInput.set("settings", settingsNode);
        ObjectNode body = JSON.objectNode();
        body.put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
        body.put("status", "ok");
        body.put("basis", LEARNED_BASIS);
        body.put("label", LEARNED_LABEL);
        body.set("runId", input.get("runId").deepCopy());
        body.set("asOf", input.get("asOf").deepCopy());
        body.set("policyVersion", input.get("policyVersion").deepCopy());
        body.put("version", CanonicalJson.digest(digestInput));
        ObjectNode inputRef = body.putObject("input");
        inputRef.set("cohortVersion", input.get("cohort").get("version").deepCopy());
        inputRef.set("termsVersion", input.get("terms").get("version").deepCopy());
        inputRef.set("horizonEnd", input.get("horizon").get("end").deepCopy());
        ObjectNode model = body.putObject("model");
        model.put("artifactId", artifact.artifactId());
        model.set("featureVersion", payload.get("featureVersion").deepCopy());
        model.set("modelVersion", payload.get("modelVersion").deepCopy());
        model.put("activationPolicyVersion", active.policyVersion());
        JsonNode effectiveFrom = active.activation().get("effectiveFrom");
        if (effectiveFrom != null) model.set("activationEffectiveFrom", effectiveFrom.deepCopy());
        ObjectNode data = body.putObject("data");
        data.set("dataHash", manifest.get("dataHash").deepCopy());
        data.set("datasetKind", manifest.get("datasetKind").deepCopy());
        data.set("generatorVersion", manifest.get("generatorVersion").deepCopy());
        data.set("trainingPolicyVersion", payload.get("policyVersion").deepCopy());
        body.set("settings", settingsNode);
        body.set("employees", employees);
        body.set("aggregate", aggregate);
        body.set("evaluation", evaluationView(summary));
        Set<String> limitations = new LinkedHashSet<>();
        limitations.add("Not validated on BMW employee choices.");
        limitations.add("Probabilities are the model's estimate over each employee's permitted vehicles or waiting, not a fit score.");
        for (JsonNode l : payload.get("limitations")) limitations.add(l.asText());
        ArrayNode limits = body.putArray("limitations");
        limitations.forEach(limits::add);
        return body;
    }

    private static List<JsonNode> rowsOf(JsonNode node) {
        List<JsonNode> rows = new ArrayList<>();
        node.forEach(rows::add);
        return rows;
    }

    /** Classes and cohorts the artifact was evaluated on, less held-out cohorts, 'wait' and 'unknown'. */
    static ObjectNode trainedCoverage(ObjectNode payload) {
        JsonNode learned = payload.get("evaluation").get("models").get("learned");
        Set<String> held = new LinkedHashSet<>();
        JsonNode heldNode = Js.get(Js.get(payload.get("trainingSettings"), "split"), "heldOutCohorts");
        if (heldNode != null && heldNode.isArray()) heldNode.forEach(h -> held.add(h.asText()));
        List<String> cohorts = new ArrayList<>();
        for (JsonNode r : rowsOf(learned.get("byCohort"))) {
            if (Js.toNumber(r.get("count")) > 0 && !held.contains(r.get("key").asText())) cohorts.add(r.get("key").asText());
        }
        List<String> classes = new ArrayList<>();
        for (JsonNode r : rowsOf(learned.get("byVehicleClass"))) {
            String key = r.get("key").asText();
            if (Js.toNumber(r.get("count")) > 0 && !key.equals("wait") && !key.equals("unknown")) classes.add(key);
        }
        cohorts.sort(String::compareTo);
        classes.sort(String::compareTo);
        ObjectNode trained = JSON.objectNode();
        trained.set("cohorts", strings(cohorts));
        trained.set("vehicleClasses", strings(classes));
        return trained;
    }

    private static ArrayNode strings(Iterable<String> values) {
        ArrayNode array = JSON.arrayNode();
        values.forEach(array::add);
        return array;
    }

    private static ArrayNode uncovered(JsonNode have, List<String> wanted) {
        Set<String> trained = new LinkedHashSet<>();
        have.forEach(h -> trained.add(h.textValue()));
        Set<String> missing = new LinkedHashSet<>();
        for (String w : wanted) if (!trained.contains(w)) missing.add(w);
        List<String> sorted = new ArrayList<>(missing);
        sorted.sort(String::compareTo);
        return strings(sorted);
    }

    private static List<String> thin(JsonNode rows) {
        List<String> keys = new ArrayList<>();
        for (JsonNode r : rows) if (Js.truthy(r.get("thin"))) keys.add(r.get("key").asText());
        keys.sort(String::compareTo);
        return keys;
    }

    private static ObjectNode evaluationView(ObjectNode summary) {
        ObjectNode view = JSON.objectNode();
        view.set("label", summary.get("label"));
        view.set("partitionCounts", summary.get("partitionCounts"));
        ObjectNode overall = view.putObject("overall");
        for (String key : List.of("learned", "expressedDemand", "deterministicFit")) {
            overall.set(key, summary.get("metrics").get(key).get("overall").deepCopy());
        }
        if (summary.has("deltas")) view.set("deltas", summary.get("deltas").deepCopy());
        ObjectNode thinNode = view.putObject("thin");
        thinNode.set("cohorts", strings(thin(summary.get("metrics").get("learned").get("byCohort"))));
        thinNode.set("vehicleClasses", strings(thin(summary.get("metrics").get("learned").get("byVehicleClass"))));
        return view;
    }

    /** One period x vehicle class cell of the aggregate; summed in employee order exactly as Node does. */
    private static final class Cell {
        final String vehicleClass;
        final String period;
        int employees;
        double expected;
        double variance;

        Cell(String vehicleClass, String period) {
            this.vehicleClass = vehicleClass;
            this.period = period;
        }
    }

    private static void score(JsonNode input, ModelArtifact artifact, Settings settings, ArrayNode employees, ArrayNode aggregate) {
        double[] coefficients = artifact.coefficients();
        String featureVersion = artifact.featureVersion();
        Map<String, Cell> cells = new LinkedHashMap<>();
        List<JsonNode> entitlements = rowsOf(input.get("cohort").get("entitlements"));
        entitlements.sort((a, b) -> a.get("entitlementId").textValue().compareTo(b.get("entitlementId").textValue()));
        for (JsonNode e : entitlements) {
            List<JsonNode> choices = rowsOf(e.get("permittedChoices"));
            choices.sort((a, b) -> a.get("derivativeId").textValue().compareTo(b.get("derivativeId").textValue()));
            List<double[]> alternatives = new ArrayList<>();
            for (JsonNode c : choices) alternatives.add(ChoiceFeatures.featureVector(c.get("attributes"), false, e.get("brief"), featureVersion));
            alternatives.add(ChoiceFeatures.featureVector(null, true, e.get("brief"), featureVersion));
            double[] p = ChoiceModel.probabilities(alternatives, coefficients);
            double waitProbability = p[p.length - 1];
            ObjectNode employee = employees.addObject();
            employee.set("entitlementId", e.get("entitlementId").deepCopy());
            ArrayNode modelled = employee.putArray("choices");
            for (int i = 0; i < choices.size(); i++) {
                modelled.addObject().put("derivativeId", choices.get(i).get("derivativeId").textValue()).put("probability", p[i]);
            }
            employee.put("waitProbability", waitProbability);
            employee.put("acceptanceProbability", 1 - waitProbability);
            Map<String, Double> byClass = new LinkedHashMap<>();
            for (int i = 0; i < choices.size(); i++) byClass.merge(choices.get(i).get("vehicleClass").textValue(), p[i], Double::sum);
            String period = e.get("period").textValue();
            for (Map.Entry<String, Double> entry : byClass.entrySet()) {
                Cell cell = cells.computeIfAbsent(period + "\u0000" + entry.getKey(), k -> new Cell(entry.getKey(), period));
                double q = entry.getValue();
                cell.employees += 1;
                cell.expected += q;
                cell.variance += q * (1 - q);
            }
        }
        List<Cell> ordered = new ArrayList<>(cells.values());
        ordered.sort((a, b) -> a.period.compareTo(b.period) != 0 ? a.period.compareTo(b.period) : a.vehicleClass.compareTo(b.vehicleClass));
        for (Cell cell : ordered) {
            double sd = Math.sqrt(cell.variance);
            ObjectNode row = aggregate.addObject();
            row.put("vehicleClass", cell.vehicleClass);
            row.put("period", cell.period);
            row.put("employees", cell.employees);
            row.put("expected", cell.expected);
            row.put("low", Math.max(0, cell.expected - settings.intervalZ() * sd));
            row.put("high", Math.min(cell.employees, cell.expected + settings.intervalZ() * sd));
        }
    }
}
