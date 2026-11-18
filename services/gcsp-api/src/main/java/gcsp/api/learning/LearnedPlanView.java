package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.planning.OrderPlanService;
import gcsp.api.planning.PlanningCatalog;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import java.util.function.ToDoubleFunction;

/** Read-only learned advice beside the baseline, with the same policy pin for inference and planning. */
public final class LearnedPlanView {
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private final Function<PolicyService, LearnedDemandForecastPort> forecasts;

    public LearnedPlanView(Function<PolicyService, LearnedDemandForecastPort> forecasts) {
        this.forecasts = forecasts;
    }

    public ObjectNode read(Principal principal, PolicyService policy, String policyVersion, PlanningDemand demand,
            PlanningSupply supply, PlanningClock clock, JsonNode baseline) {
        try {
            LearnedPlanForecast learned = new LearnedPlanForecast(demand, forecasts.apply(policy), baseline);
            PlanningSupply pinnedSupply = (read, under) -> {
                ObjectNode out = supply.readSupply(read, under);
                if (!LearnedPredictionInput.ok(out)) return out;
                for (String key : List.of("stock", "supply", "catalog")) {
                    if (!out.at("/value/versions/" + key).equals(baseline.at("/versions/" + key))) {
                        return LearnedPredictionInput.unavailable("planning-inputs-changed");
                    }
                }
                return out;
            };
            PlanningClock pinnedClock = context -> {
                PlanningClock.Observation time = clock.observe(context);
                if (!java.util.Objects.equals(time.version(), baseline.at("/versions/clock").textValue())) {
                    throw new IllegalStateException("planning-inputs-changed");
                }
                return new PlanningClock.Observation(Instant.parse(baseline.path("asOf").asText()), time.version());
            };
            ObjectNode plan = new OrderPlanService(policy, learned, pinnedSupply, pinnedClock).readPlan(principal, policyVersion);
            if ("learned-forecast-fallback".equals(plan.path("code").asText())
                    && "fallback".equals(plan.at("/fallback/status").asText())) {
                ObjectNode fallback = advisory("fallback");
                for (String key : List.of("reason", "limitation", "coverage", "model")) {
                    if (plan.path("fallback").has(key)) fallback.set(key, plan.path("fallback").get(key).deepCopy());
                }
                return fallback;
            }
            if (!plan.path("planId").isTextual() || !("feasible".equals(plan.path("status").asText())
                    || "infeasible".equals(plan.path("status").asText())) || learned.latest() == null) {
                return unavailable(plan.path("code").asText("learned-plan-unavailable"));
            }
            ObjectNode catalog = new PlanningCatalog(policy).readCatalog(principal.runId(),
                    new PolicyRead(principal.runId(), baseline.path("asOf").asText(), policyVersion));
            if (!LearnedPredictionInput.ok(catalog)) return unavailable("learned-catalog-unavailable");
            ObjectNode out = advisory("available");
            out.set("plan", plan);
            JsonNode forecast = learned.latest();
            JsonNode model = forecast.get("demandForecast");
            ObjectNode explanation = out.putObject("forecast");
            explanation.set("version", forecast.get("version").deepCopy());
            for (String key : List.of("model", "data", "settings", "aggregate", "evaluation")) {
                explanation.set(key, model.get(key).deepCopy());
            }
            explanation.set("modelExpectsWait", forecast.at("/provenance/modelExpectsWait").deepCopy());
            explanation.set("limitations", forecast.at("/forecast/limitations").deepCopy());
            out.set("differences", differences(baseline, plan, catalog.at("/value/derivatives")));
            return out;
        } catch (RuntimeException e) {
            return unavailable("learned-plan-unavailable");
        }
    }

    private static ObjectNode advisory(String status) {
        return JSON.objectNode().put("status", status).put("label", LearnedDemandForecast.LEARNED_LABEL)
                .put("recommended", false).put("submittable", false);
    }

    public static ObjectNode unavailable(String reason) {
        return advisory("unavailable").put("reason", reason)
                .put("limitation", "The learned forecast is unavailable right now, so only the baseline plan is shown.");
    }

    private static ObjectNode pair(JsonNode baseline, JsonNode learned, boolean comparable, ToDoubleFunction<JsonNode> read) {
        ObjectNode out = JSON.objectNode();
        if (!comparable) return out.putNull("baseline").putNull("learned").putNull("delta");
        double b = read.applyAsDouble(baseline), l = read.applyAsDouble(learned);
        return out.put("baseline", b).put("learned", l).put("delta", l - b);
    }

    private static double quantity(JsonNode plan, String derivativeId) {
        for (JsonNode row : plan.path("quantities")) {
            if (derivativeId.equals(row.path("derivativeId").asText())) return row.path("quantity").doubleValue();
        }
        return 0;
    }

    private static ObjectNode differences(JsonNode baseline, JsonNode learned, JsonNode catalog) {
        boolean comparable = "feasible".equals(baseline.path("status").asText()) && "feasible".equals(learned.path("status").asText());
        ObjectNode out = JSON.objectNode().put("comparable", comparable);
        out.set("coverage", pair(baseline, learned, comparable, p -> p.at("/expectedAcceptableCoverage/covered").doubleValue()));
        out.set("orderQuantity", pair(baseline, learned, comparable, p -> p.path("orderQuantity").doubleValue()));
        out.set("spendMinor", pair(baseline, learned, comparable, p -> p.path("spendMinor").doubleValue()));
        out.set("unmetNeeds", pair(baseline, learned, comparable, p -> p.path("unmetNeeds").size()));
        List<String> ids = new ArrayList<>();
        catalog.forEach(d -> ids.add(d.path("derivativeId").asText()));
        ids.sort(String::compareTo);
        ArrayNode derivatives = out.putArray("derivatives");
        for (String id : ids) {
            ObjectNode row = pair(baseline, learned, comparable, p -> quantity(p, id));
            row.put("derivativeId", id).put("changed", comparable && row.path("delta").doubleValue() != 0);
            derivatives.add(row);
        }
        return out;
    }
}
