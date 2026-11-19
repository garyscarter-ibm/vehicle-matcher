package gcsp.api.recommendation;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.JwksServerResource;
import gcsp.api.brief.BriefPreviewPort;
import gcsp.api.brief.RecommendationBriefPreview;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.WallPolicyClock;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-381 on the started app: saved and unsaved recommendations rank similar-fit cars by allowance use, over real tokens and stock. */
@QuarkusTest
@TestProfile(AllowanceRankingHttpTest.Profile.class)
class AllowanceRankingHttpTest {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    /** The version Greg publishes below; the employee principal is pinned to it. */
    static final String PINNED = "greg-381-allowance";
    static final String EXPENSIVE_KEY = "G21 Touring|330e";
    static final Instant CLOCK_NOW = Instant.parse("2026-11-05T09:00:00Z");
    static final String SAVED = "/api/gcsp/v1/recommendations";
    static final String PREVIEW = "/api/gcsp/v1/brief/preview";
    static final String EDITOR = "/api/gcsp/v1/brief/editor";
    static final String RATING = "{\"value\":1,\"contractId\":\"current:employee-paula\",\"source\":\"employee\","
            + "\"ratedAt\":\"2026-11-05T08:00:00.000Z\"}";
    static final String UUID_PREFIX = "00000000-0000-4000-8000-0000000000";

    /** The brief-journey composition on the recommendation schema, with the employee pinned to Greg's published version. */
    public static class Profile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = new HashMap<>();
            c.put("gcsp.identity.provider", "oidc");
            c.put("gcsp.oidc.issuer", ISSUER);
            c.put("gcsp.oidc.audience", AUDIENCE);
            c.put("gcsp.oidc.authorized-party", CLIENT);
            c.put("gcsp.oidc.required-scopes", "gcsp-api");
            c.put("gcsp.oidc.accounts", "[{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
                    + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]}]");
            c.put("gcsp.environment.id", RecommendationHttpProfiles.ENV);
            c.put("gcsp.environment.run-id", RecommendationHttpProfiles.RUN);
            c.put("gcsp.environment.policy-version", PINNED);
            c.put("gcsp.scenario.provider", "demo");
            c.put("gcsp.ordering.provider", "synthetic");
            c.put("gcsp.reset-allowed", "true");
            c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,gcsp.api.documents.DocumentsTestPorts$Policy,"
                    + "gcsp.api.documents.DocumentsTestPorts$Cases,gcsp.api.documents.DocumentsTestPorts$Clock");
            return RecommendationHttpProfiles.database(c, "repository");
        }

        @Override
        public java.util.Set<Class<?>> getEnabledAlternatives() {
            return java.util.Set.of();
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** A still policy clock, so Greg's publish can take effect at exactly now and replay with the same input. */
    static final class StillClock extends WallPolicyClock {
        @Override
        public Instant now(RunContext context) {
            return CLOCK_NOW;
        }
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    BriefPreviewPort previewPort;

    private String paula;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        QuarkusMock.installMockForType(new StillClock(), WallPolicyClock.class);
        RecommendationDb.seedEmployees();
        paula = token("sub-paula", "employee");
        publishExpensiveKey(token("sub-greg", "greg"));
        RecommendationDb.clearStock();
    }

    // ---- fixtures ----

    private String token(String sub, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(ISSUER);
        c.setAudience(AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk)).getPrivateKey());
        jws.setKeyIdHeaderValue(KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static Response call(String token, String method, String path, String body) {
        var spec = given().accept(ContentType.JSON).header("Authorization", "Bearer " + token);
        if (body != null) spec = spec.contentType(ContentType.JSON).body(body);
        return "GET".equals(method) ? spec.get(path) : spec.post(path);
    }

    private static JsonNode json(Response r) throws Exception {
        return RecommendationDb.JSON.readTree(r.asString());
    }

    /** Greg raises one 1100-point price to 1400 once; later calls find the version already active. */
    private void publishExpensiveKey(String greg) throws Exception {
        Response read = call(greg, "GET", "/api/gcsp/v1/greg/policy", null);
        assertEquals(200, read.statusCode(), read.asString());
        JsonNode value = json(read).get("value");
        if (PINNED.equals(value.get("activeVersion").asText())) return;
        String id = null;
        for (JsonNode f : value.get("fields")) {
            if ("price".equals(f.get("kind").asText()) && "choices-fs-uk".equals(f.get("schemeId").asText())
                    && EXPENSIVE_KEY.equals(f.path("matchValue").asText())) id = f.get("id").asText();
        }
        assertNotNull(id, "price field of " + EXPENSIVE_KEY);
        ObjectNode change = RecommendationDb.JSON.createObjectNode();
        change.put("commandId", "cmd-381-allowance").put("expectedActiveVersion", value.get("activeVersion").asText())
                .put("policyVersion", PINNED).put("effectiveFrom", value.get("asOf").asText());
        change.putArray("changes").addObject().put("id", id).put("value", 1400);
        Response published = call(greg, "POST", "/api/gcsp/v1/greg/policy/publish", change.toString());
        assertEquals(200, published.statusCode(), published.asString());
    }

    /** A released stock row cloned from the first source case; scored facts are shared unless overridden. */
    private static ObjectNode car(int n, String modelKey, String body, int boot, String modelLine) throws Exception {
        ObjectNode row = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows").get(0)
                .deepCopy();
        String uuid = UUID_PREFIX + String.format("%02d", n);
        row.put("orderUuid", uuid).put("orderNumber", "38100" + n);
        ((ObjectNode) row.get("facts").get("sourceKeys")).put("stockId", uuid);
        ObjectNode facts = (ObjectNode) row.get("facts").get("facts");
        fact(facts, "eligibilityModelKey", modelKey);
        fact(facts, "body", body);
        fact(facts, "boot", boot);
        fact(facts, "modelLine", modelLine);
        return row;
    }

    private static void fact(ObjectNode facts, String key, Object value) {
        ObjectNode f = facts.has("boot") ? facts.get("boot").deepCopy() : null;
        ObjectNode copy = f == null ? RecommendationDb.JSON.createObjectNode() : f;
        if (value instanceof Integer i) copy.put("value", i);
        else copy.put("value", (String) value);
        if (!(value instanceof Integer)) copy.putNull("unit");
        facts.set(key, copy);
    }

    private static String uuid(int n) {
        return UUID_PREFIX + String.format("%02d", n);
    }

    private static void stock(ObjectNode... rows) throws Exception {
        RecommendationDb.clearStock();
        List<JsonNode> list = new ArrayList<>(List.of(rows));
        RecommendationDb.insertStock(list);
    }

    private static ObjectNode brief(boolean saved, String essentials, String rating) throws Exception {
        String text = "{\"schemaVersion\":1," + (saved ? "\"briefVersion\":1," : "")
                + "\"preferences\":{\"body\":{\"value\":\"estate\",\"importance\":100,\"valueState\":\"confirmed\","
                + "\"importanceState\":\"confirmed\",\"source\":\"employee\"}},\"essentials\":" + essentials
                + (rating == null ? "" : ",\"currentCarRating\":" + rating) + "}";
        return (ObjectNode) RecommendationDb.JSON.readTree(text);
    }

    private JsonNode saved(ObjectNode brief) throws Exception {
        Response r = call(paula, "POST", SAVED, brief.toString());
        assertEquals(200, r.statusCode(), r.asString());
        return json(r).get("value");
    }

    private JsonNode preview(ObjectNode brief) throws Exception {
        JsonNode initial = json(call(paula, "GET", EDITOR, null)).get("value").get("initial");
        ObjectNode request = RecommendationDb.JSON.createObjectNode().put("kind", "unsaved-draft")
                .put("baseBriefVersion", initial.get("briefVersion").asLong()).put("draftVersion", initial.get("draftVersion").asLong());
        request.set("brief", brief);
        Response r = call(paula, "POST", PREVIEW, request.toString());
        assertEquals(200, r.statusCode(), r.asString());
        return json(r).get("value");
    }

    private static List<String> ids(JsonNode list) {
        List<String> out = new ArrayList<>();
        list.forEach(d -> out.add(d.get("orderUuid").asText()));
        return out;
    }

    private static JsonNode decision(JsonNode value, String uuid) {
        for (JsonNode d : value.get("decisions")) if (uuid.equals(d.get("orderUuid").asText())) return d;
        throw new AssertionError("no decision for " + uuid + " in " + ids(value.get("decisions")));
    }

    private static List<String> blockerCodes(JsonNode d) {
        return d.get("blockers").findValuesAsText("code");
    }

    // ---- AC1 ----

    @Test
    void realAppRunsThePreviewPortAndEqualFitCarsUsingMoreAllowanceRankHigher() throws Exception {
        assertEquals(RecommendationBriefPreview.class, ClientProxy.unwrap(previewPort).getClass());
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"), car(2, "G20 Saloon|320i", "estate", 500, "G20 Saloon"));
        JsonNode value = saved(brief(true, "{}", null));
        JsonNode first = value.get("recommendations").get(0);
        JsonNode second = value.get("recommendations").get(1);
        assertEquals(List.of(uuid(2), uuid(1)), ids(value.get("recommendations")));
        assertEquals(first.get("score"), second.get("score"));
        assertTrue(first.get("terms").get("points").get("value").asInt() > second.get("terms").get("points").get("value").asInt());
        assertEquals(1300, first.get("terms").get("allowanceInputs").get("allowance").get("value").asInt());
    }

    // ---- AC2 ----

    @Test
    void aStrongPreferenceMismatchCannotOutrankABetterFitByCostingMore() throws Exception {
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"), car(2, "G01 X3|20i", "suv", 500, "G01 X3"));
        JsonNode value = saved(brief(true, "{}", null));
        JsonNode estate = decision(value, uuid(1));
        JsonNode suv = decision(value, uuid(2));
        assertTrue(suv.get("terms").get("points").get("value").asInt() > estate.get("terms").get("points").get("value").asInt());
        assertTrue(estate.get("score").asDouble() - suv.get("score").asDouble() > 5, estate.get("score") + " vs " + suv.get("score"));
        List<String> shown = ids(value.get("recommendations"));
        assertEquals(uuid(1), shown.get(0));
        assertTrue(shown.indexOf(uuid(2)) != 0);
    }

    @Test
    void anUnmetEssentialAnUnknownEligibilityAndExcessivePointsNeverGainARecommendation() throws Exception {
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"),
                car(2, "G20 Saloon|320i", "estate", 400, "G20 Saloon"),
                car(3, "ZZ99 Unlisted|none", "estate", 500, "ZZ99 Unlisted"),
                car(4, EXPENSIVE_KEY, "estate", 500, "G21 Touring"));
        String boot = "{\"boot\":{\"value\":450,\"operator\":\"gte\",\"unit\":\"L\",\"state\":\"confirmed\",\"source\":\"employee\"}}";
        JsonNode value = saved(brief(true, boot, null));
        assertEquals(List.of(uuid(1)), ids(value.get("recommendations")));
        assertEquals("ineligible", decision(value, uuid(2)).get("gateStatus").asText());
        assertEquals("needs-confirmation", decision(value, uuid(3)).get("gateStatus").asText());
        JsonNode dear = decision(value, uuid(4));
        assertEquals("ineligible", dear.get("gateStatus").asText());
        assertTrue(blockerCodes(dear).contains("allowance-exceeded"), dear.get("blockers").toString());
        assertEquals(1400, dear.get("terms").get("points").get("value").asInt());
        assertEquals(1, value.get("eligibleCount").asInt());
    }

    // ---- AC3 ----

    @Test
    void anUnsavedPreviewRanksLikeTheSavedRecommendations() throws Exception {
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"), car(2, "G20 Saloon|320i", "estate", 500, "G20 Saloon"),
                car(3, "U06 Active Tourer|220i", "estate", 500, "U06 Active Tourer"), car(4, "G01 X3|20i", "suv", 500, "G01 X3"));
        JsonNode saved = saved(brief(true, "{}", null));
        JsonNode previewed = preview(brief(false, "{}", null));
        assertEquals(ids(saved.get("recommendations")), ids(previewed.get("recommendations")));
        List<String> ranked = ids(saved.get("recommendations"));
        assertEquals(ranked, ids(previewed.get("decisions")).subList(0, ranked.size()));
        assertEquals(saved.get("ranking"), previewed.get("ranking"));
        assertEquals(uuid(2), ranked.get(0));
    }

    @Test
    void currentCarFeedbackKeepsTheSameRankingRuleInSavedAndPreview() throws Exception {
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"), car(2, "G01 X3|20i", "estate", 500, "G01 X3"),
                car(3, "G21 Touring|320i", "estate", 500, "G21 Touring"));
        List<String> without = ids(saved(brief(true, "{}", null)).get("recommendations"));
        assertTrue(without.contains(uuid(3)), without.toString());
        JsonNode value = saved(brief(true, "{}", RATING));
        JsonNode similar = decision(value, uuid(3));
        assertEquals("ineligible", similar.get("gateStatus").asText());
        assertTrue(blockerCodes(similar).contains("feedback-similar-omitted"), similar.get("blockers").toString());
        assertEquals(List.of(uuid(2), uuid(1)), ids(value.get("recommendations")));
        JsonNode previewed = preview(brief(false, "{}", RATING));
        assertEquals(ids(value.get("recommendations")), ids(previewed.get("recommendations")));
        assertEquals(value.get("ranking"), previewed.get("ranking"));
    }

    // ---- AC4 ----

    @Test
    void scoresAndReasonsStayTruthfulAndTheRuleIsReported() throws Exception {
        stock(car(1, "F70 Sports Hatch|120", "estate", 500, "F70 Sports Hatch"), car(2, "G20 Saloon|320i", "estate", 500, "G20 Saloon"),
                car(3, "G01 X3|20i", "suv", 500, "G01 X3"));
        JsonNode value = saved(brief(true, "{}", null));
        assertEquals("similarFitThenPoints", value.get("ranking").get("rule").asText());
        assertEquals(5, value.get("ranking").get("fitTolerance").asInt());
        for (JsonNode shown : value.get("recommendations")) {
            JsonNode d = decision(value, shown.get("orderUuid").asText());
            assertEquals(d.get("score"), shown.get("score"));
            JsonNode sufficient = null;
            for (JsonNode r : shown.get("reasons")) if ("allowance-sufficient".equals(r.get("code").asText())) sufficient = r;
            assertNotNull(sufficient, shown.get("reasons").toString());
            assertEquals(shown.get("terms").get("points").get("value"), sufficient.get("monthlyPoints"));
            assertEquals(1300, sufficient.get("allowance").asInt());
        }
        assertFalse(value.get("recommendations").size() == 0);
    }
}
