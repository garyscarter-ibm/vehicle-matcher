package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountPolicyPort.PolicyOutcome;
import gcsp.api.account.AccountPolicyPort.PolicyRead;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** GET /api/gcsp/v1/manual/account over real JWTs, the hr-snapshot provider and golden policy outcomes. */
@QuarkusTest
@TestProfile(AccountHttpProfile.class)
class AccountHttpTest {

    private static final String PATH = "/api/gcsp/v1/manual/account";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    private RsaJsonWebKey key;
    private byte[] originalSnapshot;

    @BeforeEach
    void setUp() throws Exception {
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        originalSnapshot = Files.readAllBytes(AccountHttpProfile.SNAPSHOT);
        GoldenFixture paula = new GoldenFixture("paula");
        GoldenFixture jordan = new GoldenFixture("jordan");
        PolicyOutcome rules = paula.manualRules;
        PolicyOutcome names = paula.schemeNames;
        QuarkusMock.installMockForType(new AccountPolicyPort() {
            public PolicyOutcome manualRules(PolicyRead r) {
                return rules;
            }

            public PolicyOutcome allowance(AccountScope s, PolicyRead r) {
                return s.employeeId().equals(jordan.scope.employeeId()) ? jordan.allowance : paula.allowance;
            }

            public PolicyOutcome schemeDisplayNames(PolicyRead r) {
                return names;
            }
        }, AccountPolicyPort.class);
    }

    @AfterEach
    void restoreSnapshot() throws Exception {
        Files.write(AccountHttpProfile.SNAPSHOT, originalSnapshot);
    }

    private String token(String sub, String... roles) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(AccountHttpProfile.ISSUER);
        c.setAudience(AccountHttpProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", AccountHttpProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(roles)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(AccountHttpProfile.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private ValidatableResponse get(String token, String query) {
        var req = given();
        if (token != null) req = req.header("Authorization", "Bearer " + token);
        return req.when().get(PATH + query).then();
    }

    /** The golden value; only the clock version differs, because the pinned test clock names itself "fixed". */
    private static JsonNode expectedValue(String golden) {
        JsonNode value = new GoldenFixture(golden).golden.get("expected").get("value").deepCopy();
        if (value.has("versions")) ((com.fasterxml.jackson.databind.node.ObjectNode) value.get("versions")).put("clock", "fixed");
        return value;
    }

    private JsonNode okValue(String sub, String golden) throws Exception {
        String body = get(token(sub, "employee"), "").statusCode(200).body("status", equalTo("ok")).extract().asString();
        JsonNode tree = GoldenFixture.JSON.readTree(body);
        assertEquals(expectedValue(golden), tree.get("value"));
        return tree;
    }

    @Test
    void employeeGetsExactlyTheirGoldenAccount() throws Exception {
        okValue("sub-paula", "paula");
    }

    @Test
    void anotherEmployeeSeesOnlyTheirOwnAccount() throws Exception {
        String body = GoldenFixture.JSON.writeValueAsString(okValue("sub-jordan", "jordan"));
        for (String foreign : List.of("employee-paula", "Paula Mason", "current:employee-paula", "E749057")) {
            assertFalse(body.contains(foreign), foreign);
        }
        assertEquals(true, body.contains("employee-jordan"));
    }

    @Test
    void unmappedPersonnelNumberIsAbsentHrAccount() throws Exception {
        String body = get(token("sub-nobody", "employee"), "").statusCode(200).extract().asString();
        JsonNode tree = GoldenFixture.JSON.readTree(body);
        assertEquals(expectedValue("jordan-absent"), tree.get("value"));
        assertEquals("absent-hr-account", tree.get("value").get("state").asText());
    }

    @Test
    void gregAndPresenterAreRefusedByRole() throws Exception {
        get(token("sub-greg", "greg"), "").statusCode(403).body("code", equalTo("role-required"))
                .body("status", equalTo("forbidden")).body(not(containsString("value")));
        get(token("sub-presenter", "presenter"), "").statusCode(403).body("code", equalTo("role-required"));
    }

    @Test
    void unmappedSubjectAndMissingBearerAreRefused() throws Exception {
        get(token("sub-stranger", "employee"), "").statusCode(403).body("code", equalTo("subject-not-mapped"));
        get(null, "").statusCode(401).body("code", equalTo("bearer-missing"));
    }

    @Test
    void anyQueryParameterIsRefusedBeforeAnyRead() throws Exception {
        get(token("sub-paula", "employee"), "?employeeId=employee-jordan").statusCode(400)
                .body("status", equalTo("invalid")).body("code", equalTo("unsupported-query"))
                .body(not(containsString("employee-jordan")));
    }

    @Test
    void snapshotThatTurnsCorruptOrVanishesIsASourceFailureWithoutLeaks() throws Exception {
        String paula = token("sub-paula", "employee");
        Files.writeString(AccountHttpProfile.SNAPSHOT, "{ \"schema\": truncated");
        assertSourceFailure(get(paula, ""));
        Files.delete(AccountHttpProfile.SNAPSHOT);
        assertSourceFailure(get(paula, ""));
        Files.write(AccountHttpProfile.SNAPSHOT, originalSnapshot);
        get(paula, "").statusCode(200).body("value.state", equalTo("ready"));
    }

    private static void assertSourceFailure(ValidatableResponse r) {
        r.statusCode(503).body("status", equalTo("unavailable")).body("code", equalTo("manual-source-unavailable"))
                .body("retryable", equalTo(true)).body("source", equalTo("employee-contract"))
                .body(not(containsString("Exception"))).body(not(containsString("hr-export")))
                .body(not(containsString("account-http"))).body(not(containsString(" at gcsp")))
                .body(not(containsString("Bearer")));
    }

    @Test
    void readinessNamesTheProvider() {
        given().when().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'account-port' }.data.provider", equalTo("hr-snapshot"));
    }
}
