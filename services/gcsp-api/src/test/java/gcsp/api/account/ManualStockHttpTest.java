package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.claims.ClaimClock;
import gcsp.api.claims.ManualStockShapes;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
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

/** GET manual/stock over real JWTs, the repository provider and seeded released stock; needs GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(RepositoryHttpProfile.class)
class ManualStockHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String STOCK = "/api/gcsp/v1/manual/stock";
    private static final String DRAFT = "/api/gcsp/v1/manual/draft";
    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final Map<String, String> PAULA = Map.of("employeeId", "employee-paula",
            "environmentId", RepositoryHttpProfile.ENV, "runId", RepositoryHttpProfile.RUN);

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @BeforeEach
    void seed() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        GoldenFixture paula = new GoldenFixture("paula");
        GoldenFixture jordan = new GoldenFixture("jordan");
        // The claim clock is the wall clock; the account clock is pinned, so pin the claim clock to it too.
        QuarkusMock.installMockForType((ClaimClock) c -> java.time.Instant.parse(paula.now), ClaimClock.class);
        try (Connection c = dataSource.get().getConnection()) {
            clear(c);
            for (GoldenFixture fx : List.of(paula, jordan)) {
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN, fx.scope.employeeId());
                RepositoryFixture.seed(c, fx, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN);
            }
            StockDbFixture.insertStock(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN, StockDbFixture.rows());
        }
    }

    @AfterEach
    void clean() throws Exception {
        if (!persistence.active()) return;
        try (Connection c = dataSource.get().getConnection()) {
            clear(c);
            for (String name : List.of("paula", "jordan")) {
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN, new GoldenFixture(name).scope.employeeId());
            }
        }
    }

    /** Drafts are immutable and the schema is shared, so the test owner clears them with the claims and stock it seeds. */
    private static void clear(Connection c) throws Exception {
        try (var st = c.createStatement()) {
            st.execute("ALTER TABLE manual_drafts DISABLE TRIGGER manual_drafts_immutable");
            st.execute("DELETE FROM manual_drafts");
            st.execute("ALTER TABLE manual_drafts ENABLE TRIGGER manual_drafts_immutable");
            st.execute("ALTER TABLE manual_claims DISABLE TRIGGER manual_claims_guard");
            st.execute("DELETE FROM manual_claims");
            st.execute("ALTER TABLE manual_claims ENABLE TRIGGER manual_claims_guard");
            st.execute("DELETE FROM custody_holds");
            st.execute("DELETE FROM stock_cars");
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

    private JsonNode get(String path, String sub, String role, int status) throws Exception {
        return JSON.readTree(given().header("Authorization", "Bearer " + token(sub, role)).when().get(path).then()
                .statusCode(status).extract().asString());
    }

    private JsonNode post(String path, String sub, String json, int status) throws Exception {
        return JSON.readTree(given().header("Authorization", "Bearer " + token(sub, "employee")).contentType("application/json")
                .body(json).when().post(path).then().statusCode(status).extract().asString());
    }

    private void saveDraft(String commandId, long expected, JsonNode choices) throws Exception {
        String ctx = get("/api/gcsp/v1/manual/account", "sub-paula", "employee", 200).get("value").get("contextVersion").asText();
        post(DRAFT, "sub-paula", "{\"commandId\":\"" + commandId + "\",\"expectedDraftVersion\":" + expected
                + ",\"expectedContextVersion\":\"" + ctx + "\",\"choices\":" + choices + "}", 200);
    }

    @Test
    void withoutADraftTheAnswerIsNotFoundAndAnIntentDraftNeedsOrderOptions() throws Exception {
        JsonNode none = get(STOCK, "sub-paula", "employee", 404);
        assertEquals("not-found", none.get("status").asText());
        saveDraft("s-1", 0, StockDbFixture.intent());
        JsonNode intent = get(STOCK, "sub-paula", "employee", 409);
        assertEquals("conflict", intent.get("status").asText());
        assertEquals("order-options-required", intent.get("reason").asText());
        assertEquals("choose-order-options", intent.get("view").get("action").asText());
    }

    @Test
    void theCompleteDraftBrowsesTheCompactPayloadTheAngularClientAccepts() throws Exception {
        saveDraft("s-2", 0, StockDbFixture.complete());
        JsonNode body = get(STOCK, "sub-paula", "employee", 200);
        JsonNode v = body.get("value");
        assertEquals("manual-stock-compact-v1", v.get("payloadShape").asText());
        assertFalse(v.has("cars"));
        assertEquals(3, v.get("carIds").size());
        assertEquals(U + "1", v.get("carIds").get(0).asText());
        assertEquals(U + "3", v.get("carIds").get(1).asText());
        assertEquals(U + "6", v.get("carIds").get(2).asText());
        assertTrue(v.get("sharedVersionKeys").toString().contains("brief"));
        assertFalse(v.has("releaseHistory"));
        assertTrue(v.get("heldOffer").isNull());

        List<JsonNode> rows = ManualStockShapes.assertOkStock(body, PAULA);
        assertEquals(6, rows.size());
        JsonNode first = rows.get(0);
        assertEquals("eligible", first.get("gateStatus").asText());
        JsonNode claim = first.get("claimInput");
        assertEquals(first.get("orderUuid").asText(), claim.get("orderUuid").asText());
        assertEquals(1, claim.get("expectedStockVersion").asInt());
        assertEquals(v.get("versions").get("context").asText(), claim.get("expectedContextVersion").asText());
        assertFalse(body.toString().contains("employee-jordan"));
    }

    @Test
    void theBrowseClaimInputIsAcceptedByTheClaimRoute() throws Exception {
        saveDraft("s-3", 0, StockDbFixture.complete());
        JsonNode rows = get(STOCK, "sub-paula", "employee", 200).get("value").get("decisions");
        JsonNode claim = null;
        for (JsonNode d : rows) if (d.get("orderUuid").asText().equals(U + "1")) claim = d.get("claimInput");
        ((com.fasterxml.jackson.databind.node.ObjectNode) claim).put("commandId", "s-claim-1");
        JsonNode claimed = post("/api/gcsp/v1/manual/claim", "sub-paula", claim.toString(), 200);
        assertEquals("ok", claimed.get("status").asText());
        assertEquals(claim.get("expectedTermsDigest").asText(), claimed.get("value").get("quote").get("termsDigest").asText());
        JsonNode again = get(STOCK, "sub-paula", "employee", 200);
        assertTrue(again.get("value").has("decisions"));
    }

    @Test
    void aQueryIsRefusedAndOnlyEmployeesMayBrowse() throws Exception {
        JsonNode query = JSON.readTree(given().header("Authorization", "Bearer " + token("sub-paula", "employee"))
                .queryParam("employeeId", "employee-jordan").when().get(STOCK).then().statusCode(400).extract().asString());
        assertEquals("unsupported-query", query.get("code").asText());
        get(STOCK, "sub-greg", "greg", 403);
        given().when().get(STOCK).then().statusCode(401);
    }

    @Test
    void anotherEmployeeSeesOnlyTheirOwnDraftState() throws Exception {
        saveDraft("s-4", 0, StockDbFixture.complete());
        JsonNode jordan = get(STOCK, "sub-jordan", "employee", 404);
        assertEquals("not-found", jordan.get("status").asText());
    }
}
