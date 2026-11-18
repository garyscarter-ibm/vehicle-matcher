package gcsp.api.cases;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
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

/** FUCQ-474: renewal cases through the started app, real OIDC, demo scenario, run clock ticks and the real ports. */
@QuarkusTest
@TestProfile(CaseCompositionProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CaseCompositionJourneyHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String CASES = API + "/cases";
    private static final String TEAM = API + "/scheme-team/cases";
    private static final String OPTIONS = TEAM + "/options";
    private static final String UPDATE = TEAM + "/update";
    private static final String CLOCK = API + "/presenter/clock";
    private static final Instant PAULA_DEADLINE = Instant.parse("2026-12-01T23:59:59.999Z");
    private static final String BRIEF_REQUIRED = "A confirmed brief is required to evaluate suitable available cars.";

    private static String ownedSchema;
    private static String paulaCase;
    private static String alexCase;
    private static Instant tickedAt;
    private static long version;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    RunClockHolder holder;

    @Inject
    CaseCarSuitabilityPort suitability;

    @Inject
    AgroalDataSource dataSource;

    String paula;
    String alex;
    String greg;
    String presenter;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        paula = token("sub-paula", "employee", "gcsp-api", null);
        alex = token("sub-alex", "employee", "gcsp-api", null);
        greg = token("sub-greg", "greg", "gcsp-api", null);
        presenter = token("sub-presenter", "presenter", "gcsp-api", null);
    }

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_casejny_")) return;
        try (Connection c = DriverManager.getConnection(CaseCompositionProfile.URL); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    /** A signed token; a null key signs with the in-test JWKS key, another key shares its id but not its signature. */
    private String token(String subject, String role, String audience, RsaJsonWebKey signer) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(CaseCompositionProfile.ISSUER);
        claims.setAudience(audience);
        claims.setSubject(subject);
        claims.setExpirationTimeMinutesInTheFuture(10);
        claims.setIssuedAtToNow();
        claims.setClaim("azp", "gcsp-web");
        claims.setClaim("scope", "openid gcsp-api");
        claims.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey((signer == null ? key : signer).getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static Response get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).accept(ContentType.JSON).get(path);
    }

    private static Response post(String token, String path, String body) {
        return given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).body(body).post(path);
    }

    private static JsonNode body(Response r, int status) throws Exception {
        return JSON.readTree(r.then().statusCode(status).extract().asString());
    }

    private static String id(String label) {
        return label + "-" + UUID.randomUUID();
    }

    private Instant clockNow() {
        return Instant.parse(get(presenter, CLOCK).then().statusCode(200).extract().jsonPath().getString("value.now"));
    }

    private long clockVersion() {
        return get(presenter, CLOCK).then().statusCode(200).extract().jsonPath().getLong("value.clockVersion");
    }

    private void advance(long bySeconds) {
        post(presenter, CLOCK + "/advance", "{\"commandId\":\"" + id("adv") + "\",\"expectedClockVersion\":" + clockVersion()
                + ",\"bySeconds\":" + bySeconds + "}").then().statusCode(200);
    }

    /** The case-risk handler's outcome value for one presenter tick at the current clock. */
    private JsonNode tick() throws Exception {
        JsonNode t = body(post(presenter, CLOCK + "/tick", "{\"tickId\":\"" + id("tick") + "\",\"expectedClockVersion\":"
                + clockVersion() + "}"), 200).get("value");
        assertEquals("completed", t.get("state").asText());
        for (JsonNode o : t.get("outcomes")) {
            if ("renewal-risk-cases".equals(o.path("handlerId").asText())) {
                assertEquals("ok", o.get("outcome").get("status").asText(), o.toString());
                return o.get("outcome").get("value");
            }
        }
        throw new AssertionError("no renewal-risk-cases outcome in " + t.get("outcomes"));
    }

    private JsonNode ownCase(String token, String caseId) throws Exception {
        return body(get(token, CASES + "?caseId=" + caseId), 200).get("value").get("case");
    }

    private String update(String commandId, long expected, String status, String remedyJson) {
        return "{\"commandId\":\"" + commandId + "\",\"caseId\":\"" + paulaCase + "\",\"expectedVersion\":" + expected
                + ",\"status\":\"" + status + "\",\"reason\":\"Scheme team reviewed the renewal.\","
                + "\"nextAction\":\"Review options with Paula.\",\"dueAt\":\"2030-01-01T00:00:00.000Z\""
                + (remedyJson == null ? "" : ",\"remedy\":" + remedyJson) + "}";
    }

    private long count(String sql, Object... parameters) throws Exception {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    private long outboxRows(String caseId) throws Exception {
        return count("SELECT count(*) FROM outbox_events WHERE event_type = 'renewal-case-update' "
                + "AND payload->'caseUpdate'->>'caseId' = ?", caseId);
    }

    // ---- AC1: opens and updates supported cases with named ownership and only permitted remedies ----

    @Test
    @Order(1)
    void theStartedAppWiresTheCaseHandlerAndTheRealSuitabilityPort() {
        assertEquals(1, Collections.frequency(holder.handlerIds(), "renewal-risk-cases"), holder.handlerIds().toString());
        assertInstanceOf(RecommendationCaseSuitability.class, ClientProxy.unwrap(suitability));
    }

    @Test
    @Order(2)
    void aTickOutsideTheDeadlineWindowOpensNothing() throws Exception {
        // The profile pins the start to 17 Nov 09:00, the last day outside the 14-day window, so this never skips.
        assertEquals(Instant.parse(CaseCompositionProfile.WALL), clockNow());
        assertTrue(Duration.between(clockNow(), PAULA_DEADLINE).compareTo(Duration.ofDays(14)) > 0);
        assertEquals(0, tick().get("opened").asInt());
        assertEquals(0, body(get(paula, CASES), 200).get("value").get("cases").size());
    }

    @Test
    @Order(3)
    void aTickInsideTheWindowOpensOneSchemeTeamCasePerAtRiskEmployeeAndTheNextTickOpensNone() throws Exception {
        Instant inside = PAULA_DEADLINE.minus(Duration.ofDays(14)).plus(Duration.ofHours(1));
        long needed = Duration.between(clockNow(), inside).toSeconds();
        assertTrue(needed > 0, "the journey must cross the window boundary itself");
        advance(needed + 1);
        tickedAt = clockNow();
        // Paula and Alex end on 2026-12-01; Sam (2027-03-16, FUCQ-528) and Greg's operator renewal (12-15) are outside.
        assertEquals(2, tick().get("opened").asInt());
        assertEquals(0, tick().get("opened").asInt());
        assertEquals(tickedAt, clockNow());

        JsonNode cases = body(get(paula, CASES), 200).get("value").get("cases");
        assertEquals(1, cases.size());
        JsonNode c = cases.get(0);
        paulaCase = c.get("caseId").asText();
        assertEquals("employee-paula", c.get("employeeId").asText());
        assertEquals("scheme-team", c.get("owner").get("role").asText());
        assertEquals("Scheme team", c.get("owner").get("name").asText());
        assertEquals("renewal-deadline", c.get("trigger").get("type").asText());
        assertEquals("open", c.get("status").asText());
        assertEquals("2026-12-01", c.get("renewalDeadline").asText());
        assertEquals(1, c.get("history").size());
        assertEquals("system", c.get("history").get(0).get("actorRole").asText());
        assertEquals(tickedAt.plus(Duration.ofHours(24)), Instant.parse(c.get("dueAt").asText()));
        version = c.get("version").asLong();

        JsonNode alexCases = body(get(alex, CASES), 200).get("value").get("cases");
        assertEquals(1, alexCases.size());
        alexCase = alexCases.get(0).get("caseId").asText();
        assertEquals("employee-alex", alexCases.get(0).get("employeeId").asText());
        assertNotEquals(paulaCase, alexCase);
        assertEquals(2, body(get(greg, TEAM), 200).get("value").get("cases").size());
    }

    @Test
    @Order(4)
    void aHelpRequestJoinsTheOpenCaseInsteadOfOpeningASecond() throws Exception {
        JsonNode r = body(post(paula, CASES, "{\"commandId\":\"" + id("help") + "\",\"reason\":\"My replacement may miss my contract end.\"}"), 200);
        assertEquals(paulaCase, r.get("value").get("case").get("caseId").asText());
        assertEquals(2, r.get("value").get("case").get("history").size());
        assertEquals("employee", r.get("value").get("case").get("history").get(1).get("actorRole").asText());
        assertEquals(1, body(get(paula, CASES), 200).get("value").get("cases").size());
        version = r.get("value").get("case").get("version").asLong();
    }

    @Test
    @Order(5)
    void gregSeesOnlyTheRemediesThatAreGenuinelyPermitted() throws Exception {
        JsonNode v = body(get(greg, OPTIONS + "?caseId=" + paulaCase), 200).get("value");
        JsonNode o = v.get("options");
        assertTrue(o.get("manualDecision").get("available").asBoolean());
        assertFalse(o.get("contractExtension").get("available").asBoolean());
        assertEquals("The current policy does not permit a contract extension.", o.get("contractExtension").get("reason").asText());
        JsonNode cars = o.get("alternativeCars");
        assertFalse(cars.get("available").asBoolean());
        assertEquals(0, cars.get("items").size());
        assertEquals(BRIEF_REQUIRED, cars.get("reason").asText());
        assertFalse(cars.get("reason").asText().contains("not connected"));
        assertFalse(o.get("preferenceRelaxations").get("available").asBoolean());
        assertEquals(List.of("in-progress", "closed"), JSON.convertValue(v.get("nextStatuses"), List.class));
        assertEquals("Paula Mason", v.get("case").get("employeeName").asText());
    }

    @Test
    @Order(6)
    void gregMovesTheCaseToResolvedWithAManualDecisionAndEachChangeQueuesOneNotification() throws Exception {
        JsonNode a = body(post(greg, UPDATE, update(id("a"), version, "in-progress", null)), 200).get("value").get("case");
        assertEquals("in-progress", a.get("status").asText());
        assertEquals(version + 1, a.get("version").asLong());
        JsonNode b = body(post(greg, UPDATE, update(id("b"), a.get("version").asLong(), "remedy-proposed",
                "{\"type\":\"manual-decision\",\"decision\":\"Extend the lease on the scheme's terms.\"}")), 200).get("value").get("case");
        assertEquals("remedy-proposed", b.get("status").asText());
        assertEquals("manual-decision", b.get("remedy").get("type").asText());
        JsonNode c = body(post(greg, UPDATE, update(id("c"), b.get("version").asLong(), "resolved", null)), 200).get("value").get("case");
        assertEquals("resolved", c.get("status").asText());
        version = c.get("version").asLong();

        JsonNode own = ownCase(paula, paulaCase);
        assertEquals("resolved", own.get("status").asText());
        assertEquals("manual-decision", own.get("remedy").get("type").asText());
        assertEquals("Extend the lease on the scheme's terms.", own.get("remedy").get("decision").asText());
        // One row per version: open (1) to resolved, with the help request in between.
        assertEquals(version, outboxRows(paulaCase));
        assertEquals(version, count("SELECT count(DISTINCT payload->'caseUpdate'->>'caseVersion') FROM outbox_events "
                + "WHERE event_type = 'renewal-case-update' AND payload->'caseUpdate'->>'caseId' = ?", paulaCase));
    }

    @Test
    @Order(7)
    void aRemedyThePolicyOrTheStockDoesNotPermitIsRefusedAndNothingChanges() throws Exception {
        // A resolved case takes no further status, so use Alex's open case to reach the remedy checks.
        long before = outboxRows(alexCase);
        String move = "{\"commandId\":\"%s\",\"caseId\":\"" + alexCase + "\",\"expectedVersion\":%d,\"status\":\"%s\","
                + "\"reason\":\"Scheme team reviewed the renewal.\",\"nextAction\":\"Review options.\","
                + "\"dueAt\":\"2030-01-01T00:00:00.000Z\"%s}";
        long alexVersion = ownCase(alex, alexCase).get("version").asLong();
        JsonNode moved = body(post(greg, UPDATE, String.format(move, id("alex-a"), alexVersion, "in-progress", "")), 200)
                .get("value").get("case");
        alexVersion = moved.get("version").asLong();
        assertEquals(before + 1, outboxRows(alexCase));

        post(greg, UPDATE, String.format(move, id("ext"), alexVersion, "remedy-proposed",
                ",\"remedy\":{\"type\":\"contract-extension\",\"until\":\"2027-01-31\"}")).then().statusCode(403)
                .body("code", org.hamcrest.Matchers.equalTo("forbidden"));
        // The check looks the car up before the brief, so an unknown car is unsuitable (400), not unavailable (503).
        post(greg, UPDATE, String.format(move, id("car"), alexVersion, "remedy-proposed",
                ",\"remedy\":{\"type\":\"alternative-car\",\"orderUuid\":\"00000000-0000-4000-8000-000000000001\"}"))
                .then().statusCode(400).body("code", org.hamcrest.Matchers.equalTo("invalid-case-command"))
                .body("reasons[0].field", org.hamcrest.Matchers.equalTo("remedy.orderUuid"));
        JsonNode after = ownCase(alex, alexCase);
        assertEquals(alexVersion, after.get("version").asLong());
        assertEquals("in-progress", after.get("status").asText());
        assertTrue(after.get("remedy").isNull());
        assertEquals(before + 1, outboxRows(alexCase));
    }

    // ---- AC2: permissions and stale, denied or unavailable operations protect boundaries and truthful progress ----

    @Test
    @Order(8)
    void anotherEmployeeCannotReadACaseAndSeesOnlyTheirOwn() throws Exception {
        Response r = get(alex, CASES + "?caseId=" + paulaCase);
        r.then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("not-resource-owner"));
        String text = r.asString();
        assertFalse(text.contains(paulaCase) || text.contains("employee-paula") || text.contains("history") || text.contains("manual-decision"), text);
        JsonNode own = body(get(alex, CASES), 200).get("value").get("cases");
        assertEquals(1, own.size());
        assertEquals(alexCase, own.get(0).get("caseId").asText());
    }

    @Test
    @Order(9)
    void roleAndAuthenticationRulesHoldOnEveryEndpoint() throws Exception {
        String update = update(id("deny"), version, "closed", null);
        for (String who : List.of(paula, presenter)) {
            get(who, TEAM).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("role-required"));
            get(who, OPTIONS + "?caseId=" + paulaCase).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("role-required"));
            post(who, UPDATE, update).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("role-required"));
        }
        post(greg, CASES, "{\"commandId\":\"" + id("g") + "\",\"reason\":\"x\"}").then().statusCode(403)
                .body("code", org.hamcrest.Matchers.equalTo("role-required"));
        for (String path : List.of(CASES, TEAM, OPTIONS + "?caseId=" + paulaCase)) {
            given().get(path).then().statusCode(401).body("code", org.hamcrest.Matchers.equalTo("bearer-missing"));
        }
        given().contentType(ContentType.JSON).body(update).post(UPDATE).then().statusCode(401);
        String wrongAudience = token("sub-greg", "greg", "another-api", null);
        String otherKey = token("sub-greg", "greg", "gcsp-api", RsaJwkGenerator.generateJwk(2048));
        for (String bad : List.of(wrongAudience, otherKey)) {
            get(bad, TEAM).then().statusCode(401);
            get(bad, CASES).then().statusCode(401);
            post(bad, UPDATE, update).then().statusCode(401);
        }
    }

    @Test
    @Order(10)
    void aStaleUpdateIsRefusedWithTheCurrentVersionAndChangesNothing() throws Exception {
        long rows = outboxRows(paulaCase);
        int history = ownCase(paula, paulaCase).get("history").size();
        post(greg, UPDATE, update(id("stale"), version - 1, "closed", null)).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("stale-version"))
                .body("expectedVersion", org.hamcrest.Matchers.equalTo((int) version - 1))
                .body("currentVersion", org.hamcrest.Matchers.equalTo((int) version));
        JsonNode after = ownCase(paula, paulaCase);
        assertEquals(version, after.get("version").asLong());
        assertEquals("resolved", after.get("status").asText());
        assertEquals(history, after.get("history").size());
        assertEquals(rows, outboxRows(paulaCase));
    }

    @Test
    @Order(11)
    void anInvalidTransitionIsRefusedAndAReplayIsTruthfulAboutWhatHappenedOnce() throws Exception {
        long rows = outboxRows(paulaCase);
        post(greg, UPDATE, update(id("back"), version, "in-progress", null)).then().statusCode(400)
                .body("status", org.hamcrest.Matchers.equalTo("invalid"))
                .body("reasons[0].field", org.hamcrest.Matchers.equalTo("status"));
        assertEquals(version, ownCase(paula, paulaCase).get("version").asLong());
        assertEquals(rows, outboxRows(paulaCase));

        String close = update(id("close"), version, "closed", null);
        JsonNode first = body(post(greg, UPDATE, close), 200);
        assertNotNull(first.get("value"));
        assertTrue(first.path("replayed").isMissingNode());
        JsonNode again = body(post(greg, UPDATE, close), 200);
        assertTrue(again.get("replayed").asBoolean());
        assertEquals(first.get("value"), again.get("value"));
        post(greg, UPDATE, close.replace("Review options with Paula.", "Something else.")).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("command-input-changed"));
        assertEquals(version + 1, ownCase(paula, paulaCase).get("version").asLong());
        assertEquals(rows + 1, outboxRows(paulaCase));
    }
}
