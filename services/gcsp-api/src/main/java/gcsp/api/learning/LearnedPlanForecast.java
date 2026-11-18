package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.planning.PlanningCatalog;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningRead;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Narrows the existing permitted forecast; model probabilities can never relax an employee's gates. */
public final class LearnedPlanForecast implements PlanningDemand {
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private final PlanningDemand expressed;
    private final LearnedDemandForecastPort model;
    private final JsonNode baseline;
    private ObjectNode latest;

    public LearnedPlanForecast(PlanningDemand expressed, LearnedDemandForecastPort model, JsonNode baseline) {
        this.expressed = expressed;
        this.model = model;
        this.baseline = baseline;
    }

    ObjectNode latest() {
        return latest;
    }

    @Override
    public ObjectNode readForecast(PlanningRead read, PolicyService policy) {
        ObjectNode provided = expressed.readForecast(read, policy);
        if (!LearnedPredictionInput.ok(provided)) return provided;
        JsonNode value = provided.get("value");
        if (!value.path("version").equals(baseline.at("/versions/forecast"))
                || !value.path("cohortVersion").equals(baseline.at("/versions/cohort"))) {
            return LearnedPredictionInput.unavailable("planning-inputs-changed");
        }
        ObjectNode catalog = new PlanningCatalog(policy).readCatalog(read.runId(),
                new PolicyRead(read.runId(), read.asOf(), read.policyVersion()));
        if (!LearnedPredictionInput.ok(catalog)) return catalog;
        if (!catalog.at("/value/version").equals(value.at("/provenance/catalogVersion"))) {
            return LearnedPredictionInput.unavailable("planning-forecast-changed");
        }
        ObjectNode input = LearnedPredictionInput.create(value, catalog.get("value"), read, policy);
        if (!LearnedPredictionInput.ok(input)) return input;
        ObjectNode forecast = model.forecast(input.get("value"), new PolicyRead(read.runId(), read.asOf(), read.policyVersion()));
        if (forecast != null && "fallback".equals(forecast.path("status").asText())) {
            ObjectNode unavailable = LearnedPredictionInput.unavailable("learned-forecast-fallback");
            unavailable.set("fallback", forecast);
            return unavailable;
        }
        if (!LearnedPredictionInput.ok(forecast)) return forecast;
        Map<String, JsonNode> employees = new LinkedHashMap<>();
        forecast.path("employees").forEach(e -> employees.put(e.path("entitlementId").asText(), e));
        ArrayNode entitlements = JSON.arrayNode();
        ArrayNode waiting = JSON.arrayNode();
        double mass = forecast.at("/settings/choiceMassThreshold").doubleValue();
        double wait = forecast.at("/settings/waitExclusionThreshold").doubleValue();
        for (JsonNode entitlement : value.at("/forecast/entitlements")) {
            JsonNode employee = employees.get(entitlement.path("entitlementId").asText());
            if (employee == null) return LearnedPredictionInput.unavailable("learned-forecast-incomplete");
            if (LearnedNarrowing.expectsWait(employee.path("waitProbability").doubleValue(), wait)) {
                waiting.addObject().put("employeeId", entitlement.path("employeeId").asText()).put("reason", "model-expects-wait");
                continue;
            }
            Set<String> permitted = new LinkedHashSet<>();
            entitlement.path("acceptableDerivativeIds").forEach(id -> permitted.add(id.textValue()));
            List<LearnedNarrowing.Choice> choices = new ArrayList<>();
            for (JsonNode choice : employee.path("choices")) {
                String id = choice.path("derivativeId").asText();
                if (!permitted.contains(id)) return LearnedPredictionInput.unavailable("learned-forecast-incomplete");
                choices.add(new LearnedNarrowing.Choice(id, choice.path("probability").doubleValue()));
            }
            ObjectNode narrowed = entitlement.deepCopy();
            ArrayNode kept = narrowed.putArray("acceptableDerivativeIds");
            LearnedNarrowing.likeliest(choices, mass).forEach(kept::add);
            entitlements.add(narrowed);
        }
        ObjectNode result = JSON.objectNode().put("status", "ok")
                .put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
        ObjectNode learned = result.putObject("value");
        for (String key : List.of("runId", "asOf", "policyVersion", "cohortVersion")) learned.set(key, value.get(key).deepCopy());
        ObjectNode version = JSON.objectNode();
        version.set("expressed", value.get("version"));
        version.set("demandForecast", forecast.get("version"));
        learned.put("version", CanonicalJson.digest(version));
        ObjectNode narrowed = learned.putObject("forecast").put("basis", LearnedDemandForecast.LEARNED_BASIS);
        narrowed.set("horizonEnd", value.at("/forecast/horizonEnd").deepCopy());
        narrowed.set("entitlements", entitlements);
        Set<String> limitations = new LinkedHashSet<>();
        limitations.add("Learned model: each employee keeps the likeliest permitted vehicles covering " + Math.round(mass * 100)
                + "% of the modelled choice probability.");
        limitations.add("Employees the model expects to wait are left out of the learned plan.");
        forecast.path("limitations").forEach(l -> limitations.add(l.asText()));
        value.at("/forecast/limitations").forEach(l -> limitations.add(l.asText()));
        ArrayNode limits = narrowed.putArray("limitations");
        limitations.forEach(limits::add);
        ObjectNode provenance = ((ObjectNode) value.get("provenance")).deepCopy();
        learned.set("provenance", provenance);
        provenance.put("source", "learned-demand-forecast-over-F99-saved-briefs");
        provenance.set("expressedVersion", value.get("version").deepCopy());
        for (String key : List.of("model", "data", "settings")) provenance.set(key, forecast.get(key).deepCopy());
        provenance.put("modelExpectsWait", waiting.size());
        ArrayNode excluded = ((ArrayNode) provenance.get("excluded")).deepCopy();
        waiting.forEach(excluded::add);
        provenance.set("excluded", excluded);
        learned.set("demandForecast", forecast.deepCopy());
        latest = learned.deepCopy();
        return result;
    }
}
