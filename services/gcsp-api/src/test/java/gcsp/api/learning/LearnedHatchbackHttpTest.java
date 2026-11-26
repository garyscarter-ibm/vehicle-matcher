package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.JwksServerResource;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.PlanningCatalog;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningRead;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.planning.PostgresPlanningDemand;
import gcsp.api.planning.PostgresPlanningSupply;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyActivation;
import gcsp.api.policy.PolicyAdoption;
import gcsp.api.policy.ReviewedDefinitions;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** Dated replacement through real policy publication, PostgreSQL, OIDC and saved-brief planning adapters. */
@QuarkusTest
@TestProfile(LearnedHatchbackHttpTest.Profile.class)
class LearnedHatchbackHttpTest extends LearnedPlanHttpBase {
    static final String MODEL = "sha256:e5205f65966d87d6895509bda13fa861e87476d843aabecce7bd76bf0e4fffc2";
    static final String OLD = LearnedPlanProfiles.BASE + "+learned-model-v1";
    static final String NEXT = "fucq320-hatchback-reference-v1";
    static final String AT = "2026-11-26T09:00:04.000Z";
    private static String ownedSchema;

    @Inject Persistence persistence;
    @Inject PolicyService policy;
    @Inject PolicyActivation policyActivation;
    @Inject PolicyAdoption adoption;
    @Inject RunClockHolder clock;
    @Inject PlanningClock planningClock;
    @Inject PlanningDemand demand;
    @Inject PlanningSupply supply;
    @Inject LearningSelection selection;

    public static final class Profile implements QuarkusTestProfile {
        static final String PREFIX = "gcsp_s_hatch_";

        @Override
        public Map<String, String> getConfigOverrides() {
            String schema = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.hatch.schema",
                    k -> PREFIX + Long.toHexString(System.nanoTime())));
            Map<String, String> config = LearnedPlanProfiles.config(schema);
            config.put("gcsp.environment.policy-version", NEXT);
            config.put("gcsp.learning.active-model", "");
            return config;
        }

        @Override public Set<Class<?>> getEnabledAlternatives() { return Set.of(); }
        @Override public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    @AfterAll
    static void cleanup() throws Exception {
        dropSchema(ownedSchema, Profile.PREFIX);
        System.getProperties().remove("gcsp.test.hatch.schema");
    }

    @Test
    void datedReplacementCoversHatchbackAndStillRefusesAnActuallyPermittedUnseenBody() throws Exception {
        assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        assertInstanceOf(PostgresPlanningDemand.class, ClientProxy.unwrap(demand));
        assertInstanceOf(PostgresPlanningSupply.class, ClientProxy.unwrap(supply));
        String greg = token("sub-greg", "greg");
        var initialTime = clock.clock().now(ENV, RUN).orElseThrow();
        ModelArtifact original = selection.artifacts().read(LearnedPlanProfiles.MODEL);
        var adopted = adoption.adopt(new RunContext(ENV, RUN, "test-reviewed-adoption"), ReviewedDefinitions.CHOICE_MODEL_SET,
                OLD, initialTime.now(), LearnedPlanProfiles.BASE,
                Map.of("choice.model.reference", LearnedModelActivation.reference(original.artifactId(), original, initialTime.now())));
        assertTrue(adopted.ok(), adopted.toString());
        String beforeAt = PolicyClock.iso(clock.clock().now(ENV, RUN).orElseThrow().now());
        JsonNode historical = policy.getPolicySnapshot(new PolicyRead(RUN, beforeAt, OLD)).value().deepCopy();
        assertEquals(LearnedPlanProfiles.MODEL, active(beforeAt, OLD).artifact().artifactId());

        var now = clock.clock().now(ENV, RUN).orElseThrow();
        String at = PolicyClock.iso(now.now().isBefore(Instant.parse(AT)) ? Instant.parse(AT) : now.now().plusSeconds(1));
        String precursorAt = PolicyClock.iso(Instant.parse(at).minusMillis(1));
        ObjectNode catalog = (ObjectNode) policy.getAssumption("orderPlan.catalog.v1", new PolicyRead(RUN, beforeAt, OLD))
                .value().path("value").deepCopy();
        for (JsonNode config : catalog.path("configurations")) {
            if ("g20-saloon-320i".equals(config.path("derivativeId").asText()))
                ((ObjectNode) config.at("/facts/body")).put("value", "coupe");
        }
        var precursorMove = clock.clock().advance(new RunContext(ENV, RUN, "sub-presenter"), cmd(), now.clockVersion(), null, precursorAt);
        assertTrue(precursorMove.ok(), precursorMove.toString());
        ObjectNode fixturePatch = M.createObjectNode().put("status", "assumed").put("sourceDate", "2026-11-26")
                .put("source", "LearnedHatchbackHttpTest").put("basis", "Isolated test-only hypothetical coupe body; eligibility and terms unchanged.");
        fixturePatch.set("value", catalog);
        String precursor = "fucq320-test-coupe-catalog-v1";
        publish(OLD, precursor, precursorAt, "orderPlan.catalog.v1", fixturePatch);
        now = clock.clock().now(ENV, RUN).orElseThrow();
        var moved = clock.clock().advance(new RunContext(ENV, RUN, "sub-presenter"), cmd(), now.clockVersion(), null, at);
        assertTrue(moved.ok(), moved.toString());
        ModelArtifact artifact = selection.artifacts().read(MODEL);
        ObjectNode reference = LearnedModelActivation.reference(MODEL, artifact, Instant.parse(at));
        publish(precursor, NEXT, at, "choice.model.reference", reference);
        assertEquals(LearnedPlanProfiles.MODEL, active(PolicyClock.iso(Instant.parse(at).minusMillis(1)), null).artifact().artifactId());
        assertEquals(MODEL, active(at, null).artifact().artifactId());
        assertEquals(LearnedPlanProfiles.MODEL, active(at, OLD).artifact().artifactId());
        assertEquals(historical, policy.getPolicySnapshot(new PolicyRead(RUN, at, OLD)).value());
        JsonNode newRow = policy.getAssumption("choice.model.reference", new PolicyRead(RUN, at, NEXT)).value();
        assertEquals("2026-11-26", newRow.path("sourceDate").asText());
        assertEquals(reference.path("source"), newRow.path("source"));

        confirmBriefFor("F70 Sports Hatch", "hatchback");
        ObjectNode input = prediction(NEXT);
        assertPermitted(input, "hatchback");
        Resp response = get(greg, PLAN);
        assertEquals(200, response.status(), response.toString());
        JsonNode learned = response.body().at("/value/learned");
        assertEquals("available", learned.path("status").asText(), learned.toString());
        assertFalse(learned.path("recommended").asBoolean());
        assertFalse(learned.path("submittable").asBoolean());
        assertEquals(MODEL, learned.at("/forecast/model/artifactId").asText());
        assertEquals(NEXT, learned.at("/forecast/model/activationPolicyVersion").asText());
        assertEquals(at, learned.at("/forecast/model/activationEffectiveFrom").asText());
        assertTrue(learned.at("/forecast/aggregate").size() > 0);
        assertEquals(153, learned.at("/forecast/evaluation/partitionCounts/later").asInt());
        assertEquals("expressed-saved-demand", response.body().at("/value/presentation/forecastBasis").asText());

        confirmBriefFor("G20 Saloon", "coupe");
        assertPermitted(prediction(NEXT), "coupe");
        JsonNode refused = get(greg, PLAN).body().at("/value/learned");
        assertEquals("fallback", refused.path("status").asText(), refused.toString());
        assertEquals("outside-coverage", refused.path("reason").asText());
        assertEquals("coupe", refused.at("/coverage/vehicleClasses/0").asText());
        assertFalse(refused.has("forecast"));
        assertFalse(refused.path("recommended").asBoolean());
        assertFalse(refused.path("submittable").asBoolean());
        assertEquals(historical, policy.getPolicySnapshot(new PolicyRead(RUN, at, OLD)).value());
    }

    private ActiveChoiceModel.Active active(String at, String version) {
        ActiveChoiceModel.Active active = ActiveChoiceModel.read(policy, new PolicyRead(RUN, at, version), selection.artifacts());
        assertNotNull(active);
        return active;
    }

    private void publish(String expected, String version, String at, String key, ObjectNode patch) {
        ObjectNode command = M.createObjectNode().put("commandId", cmd()).put("expectedActiveVersion", expected)
                .put("policyVersion", version).put("effectiveFrom", at);
        command.putArray("changes").addObject().put("table", "assumptions").put("key", key).set("patch", patch);
        Principal principal = new Principal("sub-greg", List.of("greg"), ENV, RUN, null, expected, List.of());
        PolicyResult published = policy.publishPolicyVersion(principal, command, at);
        assertTrue(published.ok(), published.body().toString());
        assertEquals(version, policyActivation.activatedPolicyVersion(ENV, RUN).orElseThrow());
        if ("choice.model.reference".equals(key)) System.out.println("FUCQ320_PUBLICATION " + command);
    }

    private ObjectNode prediction(String version) {
        Instant now = planningClock.observe(new RunContext(ENV, RUN, "sub-greg")).now();
        PlanningRead read = new PlanningRead(new RunContext(ENV, RUN, "sub-greg"), PolicyClock.iso(now), version,
                PolicyClock.iso(now.plusSeconds(120 * 86400L)));
        ObjectNode expressed = demand.readForecast(read, policy);
        assertEquals("ok", expressed.path("status").asText(), expressed.toString());
        ObjectNode catalog = new PlanningCatalog(policy).readCatalog(RUN, new PolicyRead(RUN, read.asOf(), version));
        ObjectNode prepared = LearnedPredictionInput.create(expressed.path("value"), catalog.path("value"), read, policy);
        assertEquals("ok", prepared.path("status").asText(), prepared.toString());
        return (ObjectNode) prepared.path("value");
    }

    private static void assertPermitted(JsonNode input, String body) {
        assertTrue(input.at("/cohort/entitlements").size() > 0, input.toString());
        boolean found = false;
        for (JsonNode entitlement : input.at("/cohort/entitlements"))
            for (JsonNode choice : entitlement.path("permittedChoices"))
                found |= body.equals(choice.path("vehicleClass").asText());
        assertTrue(found, input.toString());
    }

    private void confirmBriefFor(String modelLine, String bodyPreference) throws Exception {
        String employee = token("sub-paula", "employee");
        JsonNode initial = get(employee, API + "/brief/editor").body().at("/value/initial");
        ObjectNode body = M.createObjectNode().put("commandId", cmd())
                .put("expectedBriefVersion", initial.path("briefVersion").asInt())
                .put("expectedDraftVersion", initial.path("draftVersion").asInt());
        ObjectNode changes = body.putObject("changes");
        changes.putObject("comfort").put("value", 50);
        changes.putObject("sportiness").put("value", 50);
        changes.putObject("body").putArray("value").add(bodyPreference);
        body.putObject("sameAgain").put("contractId", initial.at("/currentCarRating/contractId").asText()).put("on", false);
        Resp preferences = post(employee, API + "/brief/preferences", body.toString());
        assertEquals(200, preferences.status(), preferences.toString());
        JsonNode afterPreferences = get(employee, API + "/brief/editor").body().at("/value/initial");
        ObjectNode brief = (ObjectNode) afterPreferences.path("brief").deepCopy();
        ObjectNode model = ((ObjectNode) brief.path("essentials")).putObject("modelLine");
        model.put("operator", "equals").put("value", modelLine).putNull("unit").put("state", "draft").put("source", "employee");
        ObjectNode draft = M.createObjectNode().put("commandId", cmd())
                .put("expectedBriefVersion", afterPreferences.path("briefVersion").asInt())
                .put("expectedDraftVersion", afterPreferences.path("draftVersion").asInt());
        draft.set("brief", brief);
        Resp saved = post(employee, API + "/brief/draft", draft.toString());
        assertEquals(200, saved.status(), saved.toString());
        JsonNode afterDraft = get(employee, API + "/brief/editor").body().at("/value/initial");
        ObjectNode confirmation = M.createObjectNode().put("commandId", cmd())
                .put("expectedBriefVersion", afterDraft.path("briefVersion").asInt())
                .put("expectedDraftVersion", afterDraft.path("draftVersion").asInt());
        confirmation.putObject("consent").put("search", true).put("hold", true);
        Resp confirmed = post(employee, API + "/brief/confirm", confirmation.toString());
        assertEquals(200, confirmed.status(), confirmed.toString());
    }
}
