package gcsp.api.planning;

import static gcsp.api.planning.PlanningFixtures.I5;
import static gcsp.api.planning.PlanningFixtures.M;
import static gcsp.api.planning.PlanningFixtures.POLICY;
import static gcsp.api.planning.PlanningFixtures.SALOON;
import static gcsp.api.planning.PlanningFixtures.TOURING;
import static gcsp.api.planning.PlanningFixtures.json;
import static gcsp.api.planning.PlanningFixtures.principal;
import static gcsp.api.planning.PlanningFixtures.quantity;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.planning.PlanningFixtures.Ports;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.PolicySourceException;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Greg's read and preview over fixture ports and the retained seed policy. */
class OrderPlanOperationsTest {

    /** The retained seed, counting loads and any call that could change the store (invalidate). */
    private static final class RecordingSource implements PolicySource {
        final PolicySource inner;
        final AtomicInteger loads = new AtomicInteger();
        final AtomicInteger invalidations = new AtomicInteger();
        volatile List<JsonNode> last;

        RecordingSource(PolicySource inner) {
            this.inner = inner;
        }

        @Override
        public List<JsonNode> loadVersions(String runId) throws PolicySourceException {
            loads.incrementAndGet();
            last = inner.loadVersions(runId);
            return last;
        }

        @Override
        public void invalidate(String runId) {
            invalidations.incrementAndGet();
            inner.invalidate(runId);
        }
    }

    @TempDir
    java.nio.file.Path dir;

    Ports ports;
    RecordingSource source;
    PolicyService policy;
    OrderPlanOperations ops;
    AtomicInteger replans;

    @BeforeEach
    void setUp() throws Exception {
        ports = new Ports();
        ports.stock = M.createArrayNode();
        ports.stock.add(Ports.car("veh-1", TOURING));
        source = new RecordingSource(new PolicyFiles(dir, "ops").source(M.createArrayNode()));
        policy = new PolicyService(source);
        replans = new AtomicInteger();
        ops = operations(policy, ports);
    }

    private OrderPlanOperations operations(PolicyService under, Ports p) {
        PlanningClock clock = context -> new PlanningClock.Observation(PlanningFixtures.NOW, "clock-v1");
        return new OrderPlanOperations(under, p, p, clock, (context, plan) -> {
            replans.incrementAndGet();
            return M.createObjectNode().put("status", "no-submission");
        });
    }

    private JsonNode value(ObjectNode result) {
        assertEquals("ok", result.get("status").textValue(), result.toString());
        return result.get("value");
    }

    private static ObjectNode change(String key, JsonNode value) {
        return M.createObjectNode().put("key", key).set("value", value);
    }

    private JsonNode active(String key) {
        return policy.getAssumption(key, new PolicyRead(PlanningFixtures.RUN, "2026-11-06T00:00:00.000Z", POLICY)).value().get("value");
    }

    private static JsonNode body(ObjectNode... changes) {
        ObjectNode b = M.createObjectNode();
        ArrayNode list = b.putArray("changes");
        for (ObjectNode c : changes) {
            list.add(c);
        }
        return b;
    }

    private JsonNode withBound(String key, String idField, String id, String field, int to) {
        ArrayNode bounds = active(key).deepCopy();
        for (JsonNode b : bounds) {
            if (id.equals(b.get(idField).textValue())) {
                ((ObjectNode) b).put(field, to);
            }
        }
        return bounds;
    }

    @Test
    void theReadIsAFeasiblePlanFromCurrentDemandSupplyAndPolicy() {
        JsonNode v = value(ops.readPlan(principal("greg")));
        assertEquals("current", v.get("mode").textValue());
        assertFalse(v.get("preview").booleanValue());
        JsonNode plan = v.get("plan");
        assertEquals("feasible", plan.get("status").textValue());
        assertEquals(POLICY, plan.get("versions").get("policy").textValue());
        assertEquals("clock-v1", plan.get("versions").get("clock").textValue());
        // One stocked Touring covers a flexible need; the other two needs each need one new car.
        assertEquals(3 - 1, plan.get("orderQuantity").intValue());
        assertEquals(1, quantity(plan, I5));
        assertEquals(7, plan.get("policyProvenance").size());
        assertEquals("no-submission", v.get("replan").get("status").textValue());
        assertEquals("unavailable", v.get("learned").get("status").textValue());
        assertEquals("learned-forecast-not-configured", v.get("learned").get("reason").textValue());
        assertFalse(v.get("learned").get("submittable").booleanValue());
        assertEquals(5, v.get("presentation").get("derivatives").size());
        assertEquals(2, ports.demandReads.get());
        assertEquals(2, ports.supplyReads.get());
    }

    @Test
    void everyEditableKeyChangesThePlanUnderADraftVersionAndTheActivePlanIsBesideIt() {
        ObjectNode budget = change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(0));
        ObjectNode derivative = change("orderPlan.derivativeBounds", withBound("orderPlan.derivativeBounds", "derivativeId", SALOON, "min", 2));
        ObjectNode model = change("orderPlan.modelBounds", withBound("orderPlan.modelBounds", "modelId", "g20-saloon", "min", 2));
        JsonNode baseline = value(ops.readPlan(principal("greg"))).get("plan");
        for (ObjectNode edit : List.of(budget, derivative, model)) {
            JsonNode v = value(ops.previewPlan(principal("greg"), body(edit)));
            assertEquals("preview", v.get("mode").textValue());
            assertTrue(v.get("preview").booleanValue());
            assertEquals("none", v.get("writes").textValue());
            assertEquals(OrderPlanOperations.PREVIEW_MESSAGE, v.get("message").textValue());
            assertEquals(POLICY, v.get("activePolicyVersion").textValue());
            String draft = v.get("draftPolicyVersion").textValue();
            assertTrue(draft.startsWith("preview-") && draft.length() == 32, draft);
            assertEquals(draft, v.get("plan").get("versions").get("policy").textValue());
            assertEquals(draft + ":order-plan-catalog.v1", v.get("plan").get("versions").get("catalog").textValue());
            assertEquals(baseline.get("planId"), v.get("activePlan").get("planId"));
            assertNotEquals(baseline.get("planId"), v.get("plan").get("planId"), edit.get("key").textValue());
            assertEquals(edit.get("key").textValue(), v.get("changes").get(0).get("key").textValue());
        }
        // Edited budget 0 leaves only held and existing stock, so no new quantity.
        JsonNode zero = value(ops.previewPlan(principal("greg"), body(budget))).get("plan");
        assertEquals(0, quantity(zero, TOURING));
        assertEquals(2, quantity(value(ops.previewPlan(principal("greg"), body(derivative))).get("plan"), SALOON));
    }

    @Test
    void theDraftNameIsTheSameForTheSameEditsAndEditedRowsAreMarkedAssumed() {
        ObjectNode edit = change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(1000));
        JsonNode one = value(ops.previewPlan(principal("greg"), body(edit)));
        JsonNode two = value(ops.previewPlan(principal("greg"), body(edit)));
        assertEquals(one.get("draftPolicyVersion"), two.get("draftPolicyVersion"));
        JsonNode provenance = one.get("plan").get("policyProvenance");
        JsonNode budget = null;
        for (JsonNode row : provenance) {
            if (row.get("key").textValue().equals("orderPlan.budgetMinor")) {
                budget = row;
            }
        }
        assertEquals("greg-order-plan-constraints", budget.get("source").textValue());
        assertEquals("assumed", budget.get("status").textValue());
        assertEquals("2026-11-06", budget.get("sourceDate").textValue());
        assertEquals(1000, budget.get("value").intValue());
    }

    @Test
    void aPolicyKeyGregMayNotEditAndMalformedChangesAreRefused() {
        JsonNode refused = ops.previewPlan(principal("greg"), body(change("orderPlan.horizonDays", M.getNodeFactory().numberNode(5))));
        assertEquals("invalid", refused.get("status").textValue());
        assertEquals("policy-key-not-editable", refused.get("code").textValue());
        assertEquals("orderPlan.horizonDays", refused.get("keys").get(0).textValue());
        assertEquals("invalid-changes", ops.previewPlan(principal("greg"), body()).get("code").textValue());
        assertEquals("invalid-request", ops.previewPlan(principal("greg"), json("{\"changes\":[],\"x\":1}")).get("code").textValue());
        assertEquals("invalid-request", ops.previewPlan(principal("greg"), null).get("code").textValue());
        assertEquals("invalid-change-value", ops.previewPlan(principal("greg"),
                body(change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(-1)))).get("code").textValue());
        assertEquals("invalid-change-value", ops.previewPlan(principal("greg"), body(change("orderPlan.derivativeBounds",
                M.createArrayNode()))).get("code").textValue());
        assertEquals(0, ports.demandReads.get(), "refused edits never reach the producers");
    }

    @Test
    void anEditThatMakesTheBoundsContradictoryIsAnInfeasiblePlanNotAnError() {
        JsonNode bounds = withBound("orderPlan.derivativeBounds", "derivativeId", TOURING, "min", 3);
        ObjectNode edit = change("orderPlan.derivativeBounds", bounds);
        JsonNode v = value(ops.previewPlan(principal("greg"), body(edit, change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(0)))));
        assertEquals("infeasible", v.get("plan").get("status").textValue());
        assertEquals("feasible", v.get("activePlan").get("status").textValue());
    }

    @Test
    void inputsThatChangeBetweenTheTwoLoadsAreAConflict() {
        ports.laterDemandVersion = "forecast-v2";
        ObjectNode result = ops.readPlan(principal("greg"));
        assertEquals("conflict", result.get("status").textValue());
        assertEquals("planning-inputs-changed", result.get("code").textValue());
        ports.laterDemandVersion = null;
        PlanningClock moving = new PlanningClock() {
            final AtomicInteger n = new AtomicInteger();

            @Override
            public Observation observe(gcsp.api.persistence.RunContext context) {
                return new Observation(PlanningFixtures.NOW, "clock-v" + (n.incrementAndGet() > 1 ? 2 : 1));
            }
        };
        ObjectNode clockResult = new OrderPlanService(policy, ports, ports, moving)
                .readPlan(principal("greg"), POLICY);
        assertEquals("planning-inputs-changed", clockResult.get("code").textValue());
    }

    @Test
    void aRecheckConfirmsAnUnchangedPlanAndNamesWhatChangedOtherwise() {
        JsonNode plan = value(ops.readPlan(principal("greg"))).get("plan");
        String planId = plan.get("planId").textValue();
        JsonNode same = value(ops.recheck(principal("greg"), planId, plan.get("versions"), null));
        assertEquals(planId, same.get("planId").textValue());
        ports.demandVersion = "forecast-v2";
        ObjectNode stale = ops.recheck(principal("greg"), planId, plan.get("versions"), null);
        assertEquals("conflict", stale.get("status").textValue());
        assertEquals("replan-needed", stale.get("code").textValue());
        assertEquals("[\"forecast\",\"plan\"]", stale.get("changedInputs").toString());
        assertEquals("forecast-v2", stale.get("current").get("versions").get("forecast").textValue());
        assertEquals("forbidden", ops.recheck(principal("employee"), planId, plan.get("versions"), null)
                .get("status").textValue());
    }

    @Test
    void unavailableDemandOrSupplyIsReportedAndNotReplaced() {
        ports.demandOutcome = M.createObjectNode().put("status", "unavailable").put("code", "planning-forecast-not-configured");
        ObjectNode demand = ops.readPlan(principal("greg"));
        assertEquals("unavailable", demand.get("status").textValue());
        assertEquals("planning-forecast-not-configured", demand.get("code").textValue());
        ports.demandOutcome = null;
        ports.supplyOutcome = M.createObjectNode().put("status", "unavailable").put("code", "planning-supply-not-configured");
        assertEquals("planning-supply-not-configured", ops.previewPlan(principal("greg"),
                body(change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(5)))).get("code").textValue());
    }

    @Test
    void producersThatDisagreeOnVersionsAreUnavailable() {
        ports.supplyCatalogOverride = "other:catalog";
        assertEquals("planning-producer-version-mismatch", ops.readPlan(principal("greg")).get("code").textValue());
    }

    @Test
    void aPersonWithoutTheGregRoleIsRefusedBeforeAnyRead() {
        assertEquals("forbidden", ops.readPlan(principal("employee")).get("status").textValue());
        assertEquals("forbidden", ops.previewPlan(principal("employee"), body()).get("status").textValue());
        assertEquals(0, ports.demandReads.get() + ports.supplyReads.get());
        assertEquals(0, source.loads.get());
    }

    @Test
    void aPreviewWritesNothing() throws Exception {
        PolicyRead now = new PolicyRead(PlanningFixtures.RUN, "2026-11-06T00:00:00.000Z", null);
        String before = PlanDigest.of(policy.getPolicySnapshot(now).body());
        List<JsonNode> versionsBefore = List.copyOf(source.inner.loadVersions(PlanningFixtures.RUN));
        String retained = PlanDigest.of(M.valueToTree(versionsBefore));
        int sourceLoads = source.loads.get();
        JsonNode v = value(ops.previewPlan(principal("greg"), body(change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(7)))));
        String draft = v.get("draftPolicyVersion").textValue();
        // The active store is untouched: same active version, same retained content, no invalidation, the draft is unknown to it.
        assertEquals(before, PlanDigest.of(policy.getPolicySnapshot(now).body()));
        assertEquals(retained, PlanDigest.of(M.valueToTree(source.inner.loadVersions(PlanningFixtures.RUN))));
        assertEquals(1, source.inner.loadVersions(PlanningFixtures.RUN).size());
        assertEquals(0, source.invalidations.get());
        assertEquals("not-found", policy.getActiveVersion(new PolicyRead(PlanningFixtures.RUN, "2026-11-06T00:00:00.000Z", draft)).status());
        assertEquals(POLICY, policy.getActiveVersion(now).value().get("policyVersion").textValue());
        assertTrue(source.loads.get() > sourceLoads, "the active policy was only read");
        // The ports are read-only interfaces; their counters show reads and nothing else, and no replan or submit hook ran.
        assertEquals(4, ports.demandReads.get());
        assertEquals(4, ports.supplyReads.get());
        assertEquals(0, replans.get());
        assertNull(v.get("plan").get("submitted"));
    }

    @Test
    void theSeedFileOnDiskIsNotModifiedByAPreview() throws Exception {
        java.nio.file.Path seed = PolicyFiles.SEED;
        byte[] before = java.nio.file.Files.readAllBytes(seed);
        PolicyService fromSeed = new PolicyService(new RetainedFilePolicySource());
        OrderPlanOperations real = operations(fromSeed, ports);
        value(real.previewPlan(principal("greg"), body(change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(9)))));
        assertTrue(java.util.Arrays.equals(before, java.nio.file.Files.readAllBytes(seed)));
    }
}
