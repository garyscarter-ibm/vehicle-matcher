package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The manual draft routes over real JWTs and the repository provider; needs GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(RepositoryHttpProfile.class)
class ManualDraftHttpTest {

    private static final String PATH = "/api/gcsp/v1/manual/draft";
    private static final Map<String, String> PAULA = Map.of("employeeId", "employee-paula",
            "environmentId", RepositoryHttpProfile.ENV, "runId", RepositoryHttpProfile.RUN);

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    /** Drafts are immutable and the database is shared by this class's tests, so the test owner clears them. */
    private static void clearDrafts(Connection c) throws Exception {
        try (var st = c.createStatement()) {
            st.execute("ALTER TABLE manual_drafts DISABLE TRIGGER manual_drafts_immutable");
            st.execute("DELETE FROM manual_drafts");
            st.execute("ALTER TABLE manual_drafts ENABLE TRIGGER manual_drafts_immutable");
        }
    }

    @BeforeEach
    void seed() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        GoldenFixture paula = new GoldenFixture("paula");
        GoldenFixture jordan = new GoldenFixture("jordan");
        try (Connection c = dataSource.get().getConnection()) {
            clearDrafts(c);
            for (GoldenFixture fx : List.of(paula, jordan)) {
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN, fx.scope.employeeId());
                RepositoryFixture.seed(c, fx, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN);
            }
        }
    }

    @AfterEach
    void clean() throws Exception {
        if (!persistence.active()) return;
        try (Connection c = dataSource.get().getConnection()) {
            clearDrafts(c);
            for (String name : List.of("paula", "jordan")) {
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN,
                        new GoldenFixture(name).scope.employeeId());
            }
        }
    }

    private String token(String sub, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(AccountHttpProfile.ISSUER);
        c.setAudience(AccountHttpProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", AccountHttpProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(AccountHttpProfile.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private JsonNode send(String method, String path, String sub, String json, int status) throws Exception {
        var req = given().header("Authorization", "Bearer " + token(sub, "employee"));
        if (json != null) req = req.contentType("application/json").body(json);
        String body = (method.equals("GET") ? req.when().get(path) : req.when().post(path)).then().statusCode(status)
                .extract().asString();
        return GoldenFixture.JSON.readTree(body);
    }

    private static String save(String commandId, long draft, String context, JsonNode choices) {
        return "{\"commandId\":\"" + commandId + "\",\"expectedDraftVersion\":" + draft + ",\"expectedContextVersion\":\""
                + context + "\",\"choices\":" + choices + "}";
    }

    @Test
    void saveReadReplayConflictStaleDiscardAndContinueTheCounter() throws Exception {
        JsonNode account = send("GET", "/api/gcsp/v1/manual/account", "sub-paula", null, 200);
        String ctx = account.get("value").get("contextVersion").asText();

        JsonNode none = send("GET", PATH, "sub-paula", null, 200);
        assertEquals("not-found", none.get("status").asText());
        assertEquals("manual-draft", none.get("resourceType").asText());
        ManualDraftShapes.assertFailure(none, PAULA);

        JsonNode saved = send("POST", PATH, "sub-paula", save("http-1", 0, ctx, ManualDraftRulesTest.complete()), 200);
        ManualDraftShapes.assertOkDraft(saved, PAULA);
        assertEquals(1, saved.get("value").get("draftVersion").asInt());
        assertEquals("complete", saved.get("value").get("draftStage").asText());
        assertEquals("sub-paula", saved.get("value").get("savedBy").asText());
        assertFalse(saved.has("contractVersion"));

        JsonNode read = send("GET", PATH, "sub-paula", null, 200);
        ManualDraftShapes.assertOkDraft(read, PAULA);
        assertFalse(read.get("value").get("requiresRefresh").asBoolean());
        assertEquals(1, read.get("value").get("draftVersion").asInt());

        assertEquals(saved, send("POST", PATH, "sub-paula", save("http-1", 0, ctx, ManualDraftRulesTest.complete()), 200));
        JsonNode changed = send("POST", PATH, "sub-paula", save("http-1", 0, ctx, ManualDraftRulesTest.intent()), 409);
        assertEquals("conflict", changed.get("status").asText());
        assertEquals("idempotency-input-changed", changed.get("reason").asText());
        ManualDraftShapes.assertFailure(changed, PAULA);

        JsonNode stale = send("POST", PATH, "sub-paula", save("http-2", 0, ctx, ManualDraftRulesTest.complete()), 409);
        assertEquals("stale-version", stale.get("status").asText());
        assertEquals("manual-draft", stale.get("resource").asText());
        assertEquals(0, stale.get("expectedVersion").asInt());
        assertEquals(1, stale.get("currentVersion").asInt());
        assertEquals("refresh", stale.get("action").asText());
        ManualDraftShapes.assertFailure(stale, PAULA);

        JsonNode invalid = send("POST", PATH, "sub-paula", save("http-3", 1, ctx, ManualDraftRulesTest.complete().put("brand", "ford")), 400);
        assertEquals("invalid", invalid.get("status").asText());
        ManualDraftShapes.assertFailure(invalid, PAULA);

        JsonNode gone = send("POST", PATH + "/discard", "sub-paula", "{\"commandId\":\"http-d1\",\"expectedDraftVersion\":1}", 200);
        ManualDraftShapes.assertOkDiscard(gone, PAULA);
        assertEquals(2, gone.get("value").get("draftVersion").asInt());
        assertEquals(gone, send("POST", PATH + "/discard", "sub-paula", "{\"commandId\":\"http-d1\",\"expectedDraftVersion\":1}", 200));

        JsonNode absent = send("GET", PATH, "sub-paula", null, 200);
        assertEquals("not-found", absent.get("status").asText());
        assertEquals("manual-draft", absent.get("resourceType").asText());
        JsonNode second = send("POST", PATH + "/discard", "sub-paula", "{\"commandId\":\"http-d2\",\"expectedDraftVersion\":2}", 404);
        assertEquals("not-found", second.get("status").asText());
        ManualDraftShapes.assertFailure(second, PAULA);

        JsonNode again = send("POST", PATH, "sub-paula", save("http-4", 2, ctx, ManualDraftRulesTest.complete()), 200);
        ManualDraftShapes.assertOkDraft(again, PAULA);
        assertEquals(3, again.get("value").get("draftVersion").asInt());
        assertEquals(2, again.get("value").get("previousDraftVersion").asInt());
    }

    @Test
    void anotherEmployeeNeverSeesTheDraft() throws Exception {
        JsonNode jordan = send("GET", PATH, "sub-jordan", null, 200);
        assertEquals("not-found", jordan.get("status").asText());
        String body = send("GET", PATH, "sub-paula", null, 200).toString();
        assertFalse(body.contains("employee-jordan"));
        assertTrue(body.contains("manual-draft"));
    }

    @Test
    void aBodyThatIsNotAnObjectIsInvalid() throws Exception {
        JsonNode b = send("POST", PATH, "sub-paula", "[1]", 400);
        assertEquals("invalid", b.get("status").asText());
        JsonNode e = send("POST", PATH + "/discard", "sub-paula", "{\"commandId\":\"x\"}", 400);
        assertEquals("command", e.get("reasons").get(0).get("field").asText());
        ManualDraftShapes.assertFailure(e, PAULA);
    }
}
