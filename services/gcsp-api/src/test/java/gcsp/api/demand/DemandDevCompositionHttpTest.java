package gcsp.api.demand;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.postgresql.ds.PGSimpleDataSource;

/** AC1 and AC2 on the started app: real adapters, RS256 tokens and PostgreSQL, driven only by the app's own routes; cumulative. */
@QuarkusTest
@TestProfile(DemandDevCompositionProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DemandDevCompositionHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String DEMAND = API + "/greg/demand";
    private static final String SUITABILITY = API + "/presenter/suitability";
    private static final String BRIEF = API + "/brief";
    private static final String THREE = "\"changes\":{\"comfort\":{\"value\":50},\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50}}";

    private static String ownedSchema;
    private static String firstVersion;
    private static long firstClock;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    private String presenter;
    private String greg;
    private String paula;
    private String alex;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        presenter = token("sub-presenter", "presenter");
        greg = token("sub-greg", "greg");
        paula = token("sub-paula", "employee");
        alex = token("sub-alex", "employee");
    }

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_demdev_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(DemandDevCompositionProfile.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- the journey ----

    @Test
    @Order(1)
    void theStartedAppBindsTheRealAdapters() {
        assertTrue(bean(UnmetEvaluationPort.class) instanceof RecommendationUnmetEvaluation);
        assertTrue(bean(OfferRecordsPort.class) instanceof PostgresOfferRecordsAdapter);
        assertTrue(bean(AllocationRecordsPort.class) instanceof PostgresAllocationRecords);
        assertTrue(bean(DemandPolicyPort.class) instanceof PolicyDemandAdapter);
    }

    @Test
    @Order(2)
    void theDemoSupplyReleasesCarsOnTheRealClock() throws Exception {
        // The demo scenario prepares employee-paula and employee-alex without briefs, so the briefs come in step 3.
        assertEquals(0, count("SELECT count(*) FROM stock_cars WHERE state = 'released'"));
        long version = clockVersion();
        Response r = presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":" + version
                + ",\"mode\":\"next-release\"}").post(API + "/presenter/controls/tick");
        assertEquals(200, r.statusCode(), r.asString());
        assertEquals("completed", r.jsonPath().getString("value.tick.state"));
        assertTrue(count("SELECT count(*) FROM stock_cars WHERE state = 'released'") > 0);
    }

    @Test
    @Order(3)
    void employeesConfirmBriefsWithSearchAndHoldConsentThroughTheBriefRoutes() throws Exception {
        for (String who : new String[] {paula, alex}) {
            Response saved = employee(who).body(command("pref-" + cmd(), 0, draft(who), THREE)).post(BRIEF + "/preferences");
            assertEquals(200, saved.statusCode(), saved.asString());
            Response engaged = employee(who).body(command("eng-" + cmd(), 0, draft(who), "")).post(BRIEF + "/engage");
            assertEquals(200, engaged.statusCode(), engaged.asString());
            assertEquals("engaged", engaged.jsonPath().getString("value.buddy.state"));
        }
        assertEquals(2, count("SELECT count(DISTINCT employee_id) FROM brief_heads WHERE brief_version > 0"));
        assertEquals(2, count("SELECT count(*) FROM briefs WHERE (buddy ->> 'searchConsent') = 'true' AND (buddy ->> 'holdConsent') = 'true'"));
    }

    @Test
    @Order(4)
    void gregDemandCountsComeFromTheDatabaseNotFromCannedTotals() throws Exception {
        Response r = gregSpec().get(DEMAND);
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode v = JSON.readTree(r.asString()).get("value");
        assertEquals("expressed-saved-demand", v.get("basis").asText());
        assertTrue(v.at("/versions/clock").asLong() > 0);
        int threshold = v.at("/privacy/threshold").asInt();
        assertTrue(threshold >= 1, "the threshold comes from policy");
        assertEquals("gcsp-policy-v1", v.at("/privacy/policyVersion").asText());
        assertCount(v.at("/demand/activeBriefs/count"), count("SELECT count(DISTINCT h.employee_id) FROM brief_heads h WHERE h.brief_version > 0"), threshold);
        long released = count("SELECT count(*) FROM stock_cars WHERE state = 'released'");
        long total = 0;
        boolean banded = false;
        for (JsonNode line : v.at("/stock/byModelLine")) {
            JsonNode c = line.at("/released/count");
            if (c.path("kind").asText().equals("exact")) total += c.get("value").asLong();
            else banded = true;
        }
        if (!banded) assertEquals(released, total, "released stock is counted once per car");
        else assertTrue(total <= released);
        firstVersion = v.get("projectionVersion").asText();
        firstClock = v.at("/versions/clock").asLong();
        assertTrue(firstVersion.length() > 0);
    }

    @Test
    @Order(5)
    void theAllocationTickMakesHoldsAndOffersThatDemandAndSuitabilityReflect() throws Exception {
        Response t = presenterSpec().body("{\"tickId\":\"alloc-" + cmd() + "\",\"expectedClockVersion\":" + clockVersion() + "}")
                .post(API + "/presenter/clock/tick");
        assertEquals(200, t.statusCode(), t.asString());
        String allocation = t.jsonPath().getString("value.outcomes.find { it.handlerId == 'buddy-allocation' }.outcome.status");
        assertEquals("ok", allocation, t.asString());
        long holds = count("SELECT count(*) FROM custody_holds");
        long offers = count("SELECT count(*) FROM buddy_offers");
        assertTrue(holds > 0 && offers > 0, "holds=" + holds + " offers=" + offers);
        JsonNode v = JSON.readTree(gregSpec().get(DEMAND).then().statusCode(200).extract().asString()).get("value");
        assertNotEquals(firstVersion, v.get("projectionVersion").asText());
        int threshold = v.at("/privacy/threshold").asInt();
        assertCount(v.at("/holds/total/count"), holds, threshold);
        assertCount(v.at("/offers/made/count"), offers, threshold);

        JsonNode s = JSON.readTree(presenterSpec().get(SUITABILITY).then().statusCode(200).extract().asString()).get("value");
        int evaluated = 0;
        for (JsonNode car : s.get("cars")) {
            for (JsonNode cell : car.get("cells")) {
                if ("evaluated".equals(cell.path("state").asText())) {
                    evaluated++;
                    assertEquals("gcsp-policy-v1", cell.at("/recorded/policyVersion").asText());
                    assertTrue(cell.at("/recorded/briefVersion").asLong() > 0);
                }
            }
        }
        assertTrue(evaluated > 0, "at least one recorded cell: " + s);
    }

    @Test
    @Order(6)
    void rolesAndQueriesAreRefusedBeforeAnythingIsRead() {
        for (String who : new String[] {presenter, paula}) {
            given().header("Authorization", "Bearer " + who).get(DEMAND).then().statusCode(403).body("code", equalTo("role-required"));
        }
        for (String who : new String[] {greg, paula}) {
            given().header("Authorization", "Bearer " + who).get(SUITABILITY).then().statusCode(403).body("code", equalTo("role-required"));
        }
        gregSpec().queryParam("employeeId", "employee-paula").get(DEMAND).then().statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    @Order(7)
    void aLaterClockAndAChangedBriefAreVisibleAsNewVersionsAndOutdatedCells() throws Exception {
        long before = JSON.readTree(gregSpec().get(DEMAND).then().statusCode(200).extract().asString()).at("/value/versions/clock").asLong();
        assertTrue(before >= firstClock);
        presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":" + clockVersion() + ",\"bySeconds\":3600}")
                .post(API + "/presenter/clock/advance").then().statusCode(200);
        long after = JSON.readTree(gregSpec().get(DEMAND).then().statusCode(200).extract().asString()).at("/value/versions/clock").asLong();
        assertTrue(after > before, "the clock version grew: " + before + " -> " + after);

        int version = (int) count("SELECT brief_version FROM brief_heads WHERE employee_id = 'employee-paula'");
        Response saved = employee(paula).body(command("chg-" + cmd(), version, draft(paula), "\"changes\":{\"comfort\":{\"value\":100}}"))
                .post(BRIEF + "/preferences");
        assertEquals(200, saved.statusCode(), saved.asString());
        // Saving on an engaged brief confirms the next version itself.
        assertEquals(version + 1, count("SELECT brief_version FROM brief_heads WHERE employee_id = 'employee-paula'"));
        JsonNode s = JSON.readTree(presenterSpec().get(SUITABILITY).then().statusCode(200).extract().asString()).get("value");
        boolean outdated = false;
        for (JsonNode car : s.get("cars")) {
            for (JsonNode cell : car.get("cells")) {
                if ("employee-paula".equals(cell.path("employeeId").asText()) && cell.path("outdated").asBoolean()) outdated = true;
            }
        }
        assertTrue(outdated, "the changed brief makes the recorded cell outdated: " + s);
    }

    // ---- helpers ----

    private static Object bean(Class<?> type) {
        return ClientProxy.unwrap(Arc.container().instance(type).get());
    }

    private static void assertCount(JsonNode count, long actual, int threshold) {
        if (actual < threshold) {
            assertEquals("band", count.get("kind").asText());
            assertEquals(threshold, count.get("fewerThan").asInt());
        } else if ("exact".equals(count.get("kind").asText())) {
            assertEquals(actual, count.get("value").asLong());
        } else {
            assertEquals("band", count.get("kind").asText());
            assertTrue(count.has("atLeast"), "a withheld count is an at-least band");
        }
    }

    private int draft(String who) {
        return employee(who).get(BRIEF + "/editor").then().statusCode(200).extract().path("value.initial.draftVersion");
    }

    private static String command(String id, long brief, long draft, String rest) {
        return "{\"commandId\":\"" + id + "\",\"expectedBriefVersion\":" + brief + ",\"expectedDraftVersion\":" + draft
                + (rest.isEmpty() ? "" : "," + rest) + "}";
    }

    private long clockVersion() {
        return presenterSpec().get(API + "/presenter/clock").then().statusCode(200).extract().jsonPath().getLong("value.clockVersion");
    }

    private static String cmd() {
        return "cmd-" + UUID.randomUUID();
    }

    private RequestSpecification presenterSpec() {
        return given().header("Authorization", "Bearer " + presenter).contentType(ContentType.JSON);
    }

    private RequestSpecification gregSpec() {
        return given().header("Authorization", "Bearer " + greg).contentType(ContentType.JSON);
    }

    private static RequestSpecification employee(String token) {
        return given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).accept(ContentType.JSON);
    }

    private long count(String sql) throws SQLException {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql);
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private String token(String sub, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(DemandDevCompositionProfile.ISSUER);
        c.setAudience(DemandDevCompositionProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", DemandDevCompositionProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", java.util.List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }
}
