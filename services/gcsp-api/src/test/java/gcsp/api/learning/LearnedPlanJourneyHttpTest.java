package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.planning.PostgresPlanningDemand;
import gcsp.api.planning.PostgresPlanningSupply;
import gcsp.api.planning.RunPlanningClock;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * FUCQ-476 AC1 on the started app: the model is activated by the configured policy version, and Greg's plan carries
 * the learned section from the real adapters, then degrades truthfully when the model file is missing or corrupt.
 * Real RS256 tokens, real routes, native PostgreSQL in a private schema; no seeded rows and no test alternative.
 */
@QuarkusTest
@TestProfile(LearnedPlanProfiles.Learned.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class LearnedPlanJourneyHttpTest extends LearnedPlanHttpBase {

    private static final String VERSION = LearnedPlanProfiles.Learned.VERSION;
    private static final String MODEL = LearnedPlanProfiles.MODEL;
    private static String ownedSchema;
    private static JsonNode firstPlan;

    @Inject
    Persistence persistence;

    @Inject
    PlanningDemand demand;

    @Inject
    PlanningSupply supply;

    @Inject
    PlanningClock planningClock;

    @Inject
    PolicyService policy;

    @Inject
    LearningSelection selection;

    @Inject
    LearnedModelActivation activation;

    private String greg;
    private String presenter;

    @BeforeEach
    void tokens() throws Exception {
        assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        greg = token("sub-greg", "greg");
        presenter = token("sub-presenter", "presenter");
    }

    @AfterAll
    static void cleanUp() throws Exception {
        dropSchema(ownedSchema, LearnedPlanProfiles.Learned.SCHEMA_PREFIX);
        Object dir = System.getProperties().remove("gcsp.test.learnj.artifact-dir");
        if (dir != null && Files.isDirectory(Path.of(dir.toString()))) {
            try (Stream<Path> paths = Files.walk(Path.of(dir.toString()))) {
                paths.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    private static Path artifactFile() {
        return Path.of(System.getProperties().getProperty("gcsp.test.learnj.artifact-dir"), MODEL.substring(7) + ".json");
    }

    // ---- 0: the composition and the activation ----

    @Test
    @Order(0)
    void theStartedAppUsesTheRealBindingsAndTheConfiguredVersionHoldsTheModelReference() throws Exception {
        assertInstanceOf(PostgresPlanningDemand.class, ClientProxy.unwrap(demand));
        assertInstanceOf(PostgresPlanningSupply.class, ClientProxy.unwrap(supply));
        assertInstanceOf(RunPlanningClock.class, ClientProxy.unwrap(planningClock));
        assertTrue(List.of("adopted", "present").contains(activation.summary()), activation.summary());
        assertEquals(1, count("SELECT count(*) FROM policy_versions WHERE policy_version = ?", VERSION));
        JsonNode adoption = M.readTree(text("SELECT adoption::text FROM policy_versions WHERE policy_version = ?", VERSION));
        assertEquals("fucq115-choice-model-v1", adoption.get("definitionSetId").asText());
        assertEquals("choice.model.reference", adoption.at("/overrides/0/key").asText());
        assertEquals(MODEL, adoption.at("/overrides/0/value/artifactId").asText());
        assertEquals("vehicle-preference-v1", adoption.at("/overrides/0/value/featureVersion").asText());
    }

    // ---- 1: inputs through the real writers ----

    @Test
    @Order(1)
    void demandIsAConfirmedBriefAndSupplyIsTheDemoRelease() throws Exception {
        tick(presenter);
        confirmBrief("sub-paula", true);
        assertEquals(1, count("SELECT count(*) FROM briefs WHERE employee_id = 'employee-paula' AND brief_version = 1"));
    }

    // ---- 2: the learned section beside the baseline ----

    @Test
    @Order(2)
    void gregsPlanCarriesTheLearnedSectionFromTheRealInputs() throws Exception {
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        JsonNode plan = read.body().at("/value/plan");
        firstPlan = plan.deepCopy();
        assertEquals("feasible", plan.get("status").asText());
        assertEquals(VERSION, plan.at("/versions/policy").asText());
        JsonNode learned = read.body().at("/value/learned");
        assertAdvisory(learned, VERSION);
    }

    // ---- 3: the same pin gives the same learned answer in process ----

    @Test
    @Order(3)
    void theHttpLearnedSectionEqualsTheViewOverTheSamePortsAndPin() throws Exception {
        Resp read = get(greg, PLAN);
        JsonNode http = read.body().at("/value/learned");
        JsonNode again = M.readTree(inProcess(read.body().at("/value/plan")).toString());
        assertEquals(http.get("status"), again.get("status"));
        assertEquals(http.path("reason"), again.path("reason"));
        assertEquals(http.at("/forecast/version"), again.at("/forecast/version"));
        assertEquals(http.at("/forecast/model"), again.at("/forecast/model"));
        assertEquals(http.at("/forecast/aggregate"), again.at("/forecast/aggregate"));
    }

    // ---- 4: a second brief and a preview ----

    @Test
    @Order(4)
    void aSecondBriefAndAPreviewStillCarryTheLearnedSectionAndWriteNothing() throws Exception {
        confirmBrief("sub-alex", true);
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        assertNotEquals(firstPlan.get("planId"), read.body().at("/value/plan/planId"));
        assertAdvisory(read.body().at("/value/learned"), VERSION);

        long before = count("SELECT count(*) FROM production_submissions") + count("SELECT count(*) FROM production_requests")
                + count("SELECT count(*) FROM policy_versions");
        ArrayNode bounds = withBound("orderPlan.derivativeBounds", "derivativeId", "g21-touring-320i", "min", 2);
        ObjectNode edit = M.createObjectNode().put("key", "orderPlan.derivativeBounds");
        edit.set("value", bounds);
        ObjectNode body = M.createObjectNode();
        body.putArray("changes").add(edit);
        Resp preview = post(greg, PLAN + "/preview", body.toString());
        assertEquals(200, preview.status(), preview.toString());
        assertEquals("none", preview.body().at("/value/writes").asText());
        assertAdvisory(preview.body().at("/value/learned"), preview.body().at("/value/draftPolicyVersion").asText());
        assertEquals(before, count("SELECT count(*) FROM production_submissions") + count("SELECT count(*) FROM production_requests")
                + count("SELECT count(*) FROM policy_versions"));
    }

    // ---- 5: a missing then a corrupt model ----

    @Test
    @Order(5)
    void aMissingModelFileFallsBackAndTheBaselinePlanStillReads() throws Exception {
        Files.delete(artifactFile());
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        assertEquals("feasible", read.body().at("/value/plan/status").asText());
        JsonNode learned = read.body().at("/value/learned");
        assertEquals("fallback", learned.get("status").asText(), learned.toString());
        assertEquals("artifact-missing", learned.get("reason").asText());
        assertEquals(MODEL, learned.at("/model/artifactId").asText());
        assertFalse(learned.get("recommended").asBoolean());
        assertFalse(learned.get("submittable").asBoolean());
    }

    @Test
    @Order(6)
    void aCorruptModelFileFallsBackAndTheBaselinePlanStillReads() throws Exception {
        Files.write(artifactFile(), "{\"not\":\"the model\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        assertEquals("feasible", read.body().at("/value/plan/status").asText());
        JsonNode learned = read.body().at("/value/learned");
        assertEquals("fallback", learned.get("status").asText(), learned.toString());
        assertEquals("artifact-invalid", learned.get("reason").asText());
        assertFalse(learned.get("recommended").asBoolean());
        assertFalse(learned.get("submittable").asBoolean());
    }

    // ---- helpers ----

    private ObjectNode inProcess(JsonNode baseline) {
        Principal principal = new Principal("sub-greg", List.of("greg"), ENV, RUN, null, VERSION, List.of());
        return new gcsp.api.learning.LearnedPlanView(under -> new LearnedDemandForecast(under, selection.artifacts()))
                .read(principal, policy, VERSION, demand, supply, planningClock, baseline);
    }

    /** The real inputs (a saved brief with the 430 litre answer) are covered by the model, so the section is available. */
    private static void assertAdvisory(JsonNode learned, String pin) {
        assertEquals("available", learned.get("status").asText(), learned.toString());
        assertEquals("Learned model", learned.get("label").asText());
        assertFalse(learned.get("recommended").asBoolean());
        assertFalse(learned.get("submittable").asBoolean());
        assertEquals(MODEL, learned.at("/forecast/model/artifactId").asText());
        assertEquals(pin, learned.at("/forecast/model/activationPolicyVersion").asText());
        JsonNode aggregate = learned.at("/forecast/aggregate");
        assertTrue(aggregate.isArray() && aggregate.size() > 0, aggregate.toString());
        for (JsonNode row : aggregate) {
            for (String key : List.of("vehicleClass", "expected", "low", "high")) assertTrue(row.has(key), row.toString());
            assertTrue(row.get("low").doubleValue() <= row.get("expected").doubleValue()
                    && row.get("expected").doubleValue() <= row.get("high").doubleValue(), row.toString());
        }
        assertFalse(learned.at("/forecast/evaluation").isMissingNode());
        JsonNode limits = learned.at("/forecast/limitations");
        assertTrue(limits.toString().contains("Synthetic-trained; not validated on BMW employee choices."), limits.toString());
        assertTrue(learned.at("/differences/comparable").asBoolean(), learned.at("/differences").toString());
        assertTrue(learned.at("/differences/derivatives").size() > 0);
    }

    private ArrayNode withBound(String key, String idField, String id, String field, int to) {
        String asOf = PolicyClock.iso(planningClock.observe(new gcsp.api.persistence.RunContext(ENV, RUN, "sub-greg")).now());
        ArrayNode bounds = ((ArrayNode) policy.getAssumption(key, new PolicyRead(RUN, asOf, VERSION)).value().get("value")).deepCopy();
        for (JsonNode b : bounds) {
            if (id.equals(b.get(idField).asText())) ((ObjectNode) b).put(field, to);
        }
        return bounds;
    }

}
