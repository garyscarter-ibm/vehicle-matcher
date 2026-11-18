package gcsp.api.planning;

import static gcsp.api.planning.PlanningFixtures.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.learning.DirectoryArtifactStore;
import gcsp.api.learning.LearnedDemandForecast;
import gcsp.api.learning.LearnedPlanView;
import gcsp.api.learning.ModelArtifacts;
import gcsp.api.policy.PolicyService;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real Java inference and retained artifact, with explicit synthetic planning inputs. */
class LearnedPlanOperationsTest {
    static final String ARTIFACT = "sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d";
    final ModelArtifacts artifacts = new ModelArtifacts(new DirectoryArtifactStore(Path.of("../../docs/gcsp/models/artifacts")));

    static class Demand extends Ports {
        boolean contexts = true;
        boolean catalogChanged;
        boolean badBrief;
        boolean changeAfterBaseline;
        @Override public ObjectNode readForecast(PlanningRead read, PolicyService policy) {
            ObjectNode out = super.readForecast(read, policy);
            ObjectNode value = (ObjectNode) out.get("value");
            if (changeAfterBaseline && demandReads.get() > 2) value.put("version", "changed-after-baseline");
            value.putObject("provenance").put("catalogVersion", catalogChanged ? "stale-catalog" : read.policyVersion() + ":order-plan-catalog.v1")
                    .putArray("excluded");
            if (contexts) {
                ArrayNode saved = value.putObject("predictionContext").putArray("entitlements");
                for (JsonNode entitlement : value.path("forecast").path("entitlements")) {
                    ObjectNode row = saved.addObject();
                    row.set("entitlementId", entitlement.get("entitlementId"));
                    row.putObject("employee").put("employeeId", entitlement.path("employeeId").asText())
                            .put("companyId", "demo-bmw-fs-uk").put("schemeId", "choices-fs-uk").put("gradeId", "G1-6");
                    ObjectNode brief = row.putObject("brief").put("briefVersion", 1);
                    brief.putObject("preferences");
                    brief.putObject("essentials");
                    if (badBrief) brief.put("preferences", "invalid");
                }
            }
            return out;
        }
    }

    static PolicyService policy(boolean activate, double waitThreshold) throws Exception {
        ObjectNode seed = PolicyFiles.seed();
        ArrayNode assumptions = (ArrayNode) seed.get("assumptions");
        ((ObjectNode) PolicyFiles.row(assumptions, "forecast.learned.v1").get("value")).put("waitExclusionThreshold", waitThreshold);
        if (activate) {
            ObjectNode ref = PolicyFiles.row(assumptions, "forecast.learned.v1").deepCopy();
            ref.put("key", "choice.model.reference");
            ref.putObject("value").put("artifactId", ARTIFACT).put("featureVersion", "vehicle-preference-v1").put("schemaVersion", 1);
            assumptions.add(ref);
        }
        return new PolicyService(runId -> List.of(seed));
    }

    OrderPlanOperations operations(PolicyService policy, Demand demand) {
        return new OrderPlanOperations(policy, demand, demand,
                context -> new PlanningClock.Observation(NOW, "clock-v1"),
                (context, plan) -> M.createObjectNode().put("status", "no-submission"),
                new LearnedPlanView(under -> new LearnedDemandForecast(under, artifacts)));
    }

    static JsonNode value(ObjectNode out) {
        assertEquals("ok", out.path("status").asText(), out.toPrettyString());
        return out.get("value");
    }

    @Test void retainedInferenceFlowsThroughThePlannerWithUncertaintyAndAdvisoryDifferences() throws Exception {
        Demand demand = new Demand();
        JsonNode out = value(operations(policy(true, 1), demand).readPlan(principal("greg")));
        JsonNode learned = out.get("learned");
        assertEquals("available", learned.path("status").asText(), learned.toPrettyString());
        assertFalse(learned.path("recommended").asBoolean(true));
        assertFalse(learned.path("submittable").asBoolean(true));
        assertEquals(ARTIFACT, learned.at("/forecast/model/artifactId").asText());
        assertEquals("synthetic", learned.at("/forecast/data/datasetKind").asText());
        assertEquals(POLICY, learned.at("/forecast/model/activationPolicyVersion").asText());
        assertEquals(learned.at("/forecast/version"), learned.at("/plan/versions/forecast"));
        assertEquals(3, learned.at("/plan/expectedAcceptableCoverage/total").asInt());
        assertTrue(learned.at("/forecast/aggregate").size() > 0);
        for (JsonNode cell : learned.at("/forecast/aggregate")) {
            assertTrue(cell.path("low").doubleValue() <= cell.path("expected").doubleValue());
            assertTrue(cell.path("expected").doubleValue() <= cell.path("high").doubleValue());
        }
        assertTrue(learned.at("/forecast/limitations").toString().contains("Not validated on BMW employee choices."));
        assertDifferences(out.get("plan"), learned);
        assertEquals(4, demand.demandReads.get(), "two coherent reads per baseline and learned plan");
    }

    @Test void noActiveModelExplainsFallbackAndKeepsTheBaselineUsable() throws Exception {
        JsonNode out = value(operations(policy(false, 1), new Demand()).readPlan(principal("greg")));
        assertEquals("feasible", out.at("/plan/status").asText());
        assertEquals("fallback", out.at("/learned/status").asText());
        assertEquals("no-active-model", out.at("/learned/reason").asText());
        assertTrue(out.at("/learned/limitation").asText().contains("No learned model is active"));
        assertFalse(out.get("learned").has("plan"));
    }

    @Test void missingOrInvalidPredictionSourcesLeaveTheBaselineUsable() throws Exception {
        for (String variant : List.of("missing", "brief", "catalog")) {
            Demand demand = new Demand();
            demand.contexts = !variant.equals("missing");
            demand.badBrief = variant.equals("brief");
            demand.catalogChanged = variant.equals("catalog");
            JsonNode out = value(operations(policy(true, 1), demand).readPlan(principal("greg")));
            assertEquals("feasible", out.at("/plan/status").asText());
            assertEquals("unavailable", out.at("/learned/status").asText());
            assertEquals(switch (variant) {
                case "missing" -> "prediction-input-sources-missing";
                case "brief" -> "prediction-input-invalid";
                default -> "planning-forecast-changed";
            }, out.at("/learned/reason").asText());
        }
    }

    @Test void aPreviewScoresAndPlansUnderItsDisposablePolicy() throws Exception {
        PolicyService policy = policy(true, 1);
        JsonNode out = value(operations(policy, new Demand()).previewPlan(principal("greg"),
                json("{\"changes\":[{\"key\":\"orderPlan.budgetMinor\",\"value\":0}]}")));
        assertEquals("available", out.at("/learned/status").asText(), out.toPrettyString());
        assertEquals(out.get("draftPolicyVersion"), out.at("/learned/plan/versions/policy"));
        assertEquals(out.get("draftPolicyVersion"), out.at("/learned/forecast/model/activationPolicyVersion"));
        assertEquals(0, out.at("/learned/plan/orderQuantity").asInt());
        assertEquals("none", out.path("writes").asText());
        assertDifferences(out.get("plan"), out.get("learned"));
        assertEquals(POLICY, policy.getActiveVersion(new gcsp.api.policy.PolicyRead(RUN, "2026-11-06T00:00:00.000Z", null))
                .value().path("policyVersion").asText());
    }

    @Test void modelWaitsAreExcludedOnlyFromTheLearnedPlan() throws Exception {
        JsonNode out = value(operations(policy(true, 0), new Demand()).readPlan(principal("greg")));
        assertEquals("available", out.at("/learned/status").asText());
        assertEquals(3, out.at("/learned/forecast/modelExpectsWait").asInt());
        assertEquals(0, out.at("/learned/plan/expectedAcceptableCoverage/total").asInt());
        assertEquals(3, out.at("/plan/expectedAcceptableCoverage/total").asInt());
        assertDifferences(out.get("plan"), out.get("learned"));
    }

    @Test void changedExpressedInputsCannotProduceAdviceAgainstAnOlderBaseline() throws Exception {
        Demand demand = new Demand();
        demand.changeAfterBaseline = true;
        JsonNode out = value(operations(policy(true, 1), demand).readPlan(principal("greg")));
        assertEquals("feasible", out.at("/plan/status").asText());
        assertEquals("unavailable", out.at("/learned/status").asText());
        assertEquals("planning-inputs-changed", out.at("/learned/reason").asText());
    }

    @Test void aProviderExceptionCannotInvalidateTheBaseline() throws Exception {
        Demand demand = new Demand();
        PolicyService policy = policy(true, 1);
        OrderPlanOperations ops = new OrderPlanOperations(policy, demand, demand,
                context -> new PlanningClock.Observation(NOW, "clock-v1"),
                (context, plan) -> M.createObjectNode().put("status", "no-submission"),
                new LearnedPlanView(under -> (input, read) -> { throw new IllegalStateException("failed model source"); }));
        JsonNode out = value(ops.readPlan(principal("greg")));
        assertEquals("feasible", out.at("/plan/status").asText());
        assertEquals(3, out.at("/plan/orderQuantity").asInt());
        assertEquals("unavailable", out.at("/learned/status").asText());
        assertFalse(out.at("/learned/submittable").asBoolean(true));
    }

    @Test void changedSupplyCannotProduceAdviceAgainstAnOlderBaseline() throws Exception {
        Demand demand = new Demand() {
            @Override public ObjectNode readSupply(PlanningRead read, PolicyService policy) {
                ObjectNode out = super.readSupply(read, policy);
                if (supplyReads.get() > 2) ((ObjectNode) out.at("/value/versions")).put("stock", "changed-stock");
                return out;
            }
        };
        JsonNode out = value(operations(policy(true, 1), demand).readPlan(principal("greg")));
        assertEquals("feasible", out.at("/plan/status").asText());
        assertEquals("unavailable", out.at("/learned/status").asText());
        assertEquals("planning-inputs-changed", out.at("/learned/reason").asText());
    }

    @Test void anInfeasibleComparisonHasNullDeltasAndNoChangedDerivative() throws Exception {
        PolicyService policy = policy(true, 1);
        ArrayNode bounds = policy.getAssumption("orderPlan.derivativeBounds",
                new gcsp.api.policy.PolicyRead(RUN, "2026-11-06T00:00:00.000Z", POLICY)).value().get("value").deepCopy();
        for (JsonNode b : bounds) if (TOURING.equals(b.path("derivativeId").asText())) ((ObjectNode) b).put("min", 1);
        ObjectNode input = M.createObjectNode();
        ArrayNode changes = input.putArray("changes");
        changes.addObject().put("key", "orderPlan.budgetMinor").put("value", 0);
        changes.addObject().put("key", "orderPlan.derivativeBounds").set("value", bounds);
        JsonNode out = value(operations(policy, new Demand()).previewPlan(principal("greg"), input));
        assertEquals("infeasible", out.at("/plan/status").asText());
        assertEquals("available", out.at("/learned/status").asText());
        assertFalse(out.at("/learned/differences/comparable").asBoolean(true));
        for (String name : List.of("coverage", "orderQuantity", "spendMinor", "unmetNeeds")) {
            JsonNode pair = out.at("/learned/differences/" + name);
            for (String key : List.of("baseline", "learned", "delta")) assertTrue(pair.path(key).isNull(), name + key);
        }
        for (JsonNode derivative : out.at("/learned/differences/derivatives")) {
            assertTrue(derivative.path("delta").isNull());
            assertFalse(derivative.path("changed").asBoolean(true));
        }
    }

    @Test void outsideCoverageFallbackRetainsModelIdentityAndMissingClasses() throws Exception {
        PolicyService active = policy(true, 1);
        ObjectNode seed = active.getPolicySnapshot(new gcsp.api.policy.PolicyRead(RUN, "2026-11-06T00:00:00.000Z", POLICY)).value().deepCopy();
        for (JsonNode configuration : PolicyFiles.row(seed.get("assumptions"), "orderPlan.catalog.v1").at("/value/configurations")) {
            ((ObjectNode) configuration.at("/facts/body")).put("value", "outside-training");
        }
        JsonNode out = value(operations(new PolicyService(runId -> List.of(seed)), new Demand()).readPlan(principal("greg")));
        assertEquals("feasible", out.at("/plan/status").asText());
        assertEquals("fallback", out.at("/learned/status").asText());
        assertEquals("outside-coverage", out.at("/learned/reason").asText());
        assertEquals(ARTIFACT, out.at("/learned/model/artifactId").asText());
        assertEquals("outside-training", out.at("/learned/coverage/vehicleClasses/0").asText());
    }

    static void assertDifferences(JsonNode baseline, JsonNode learned) {
        JsonNode plan = learned.get("plan");
        assertTrue(learned.at("/differences/comparable").asBoolean());
        for (String name : List.of("orderQuantity", "spendMinor")) {
            JsonNode pair = learned.at("/differences/" + name);
            assertEquals(baseline.get(name).doubleValue(), pair.path("baseline").doubleValue());
            assertEquals(plan.get(name).doubleValue(), pair.path("learned").doubleValue());
            assertEquals(plan.get(name).doubleValue() - baseline.get(name).doubleValue(), pair.path("delta").doubleValue());
        }
    }
}
