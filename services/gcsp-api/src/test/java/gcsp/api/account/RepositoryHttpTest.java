package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountPolicyPort.PolicyOutcome;
import gcsp.api.account.AccountPolicyPort.PolicyRead;
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

/** GET /api/gcsp/v1/manual/account with provider repository over the native cluster; needs GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(RepositoryHttpProfile.class)
class RepositoryHttpTest {

    private static final String PATH = "/api/gcsp/v1/manual/account";
    private static final List<String> GOLDENS = List.of("paula", "jordan");

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
        try (Connection c = dataSource.get().getConnection()) {
            for (String name : GOLDENS) {
                GoldenFixture fx = new GoldenFixture(name);
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN, fx.scope.employeeId());
                RepositoryFixture.seed(c, fx, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN);
            }
        }
    }

    @AfterEach
    void clean() throws Exception {
        if (!persistence.active()) return;
        try (Connection c = dataSource.get().getConnection()) {
            for (String name : GOLDENS) {
                RepositoryFixture.remove(c, RepositoryHttpProfile.ENV, RepositoryHttpProfile.RUN,
                        new GoldenFixture(name).scope.employeeId());
            }
        }
    }

    private String token(String sub) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(AccountHttpProfile.ISSUER);
        c.setAudience(AccountHttpProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", AccountHttpProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(AccountHttpProfile.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    /** The golden value with the pinned clock's name and this database's run id (which also feeds contextVersion). */
    private static JsonNode expectedValue(String golden) {
        JsonNode value = new GoldenFixture(golden).golden.get("expected").get("value").deepCopy();
        ((ObjectNode) value.get("versions")).put("clock", "fixed");
        value.get("slots").forEach(s -> ((ObjectNode) s).put("runId", RepositoryHttpProfile.RUN));
        return value;
    }

    /** The response value; contextVersion is checked for shape here and is exact in RepositoryParityTest. */
    private JsonNode get(String sub, String golden) throws Exception {
        String body = given().header("Authorization", "Bearer " + token(sub)).when().get(PATH).then().statusCode(200)
                .body("status", equalTo("ok")).extract().asString();
        ObjectNode value = (ObjectNode) GoldenFixture.JSON.readTree(body).get("value");
        String version = value.get("contextVersion").asText();
        assertTrue(version.matches("[0-9a-f]{64}"), version);
        assertNotEquals(new GoldenFixture(golden).golden.get("expected").get("value").get("contextVersion").asText(), version);
        value.set("contextVersion", new GoldenFixture(golden).golden.get("expected").get("value").get("contextVersion"));
        return value;
    }

    @Test
    void employeeGetsExactlyTheirGoldenAccountFromPostgreSql() throws Exception {
        assertEquals(expectedValue("paula"), get("sub-paula", "paula"));
        assertEquals(expectedValue("jordan"), get("sub-jordan", "jordan"));
    }

    @Test
    void employeeWithoutARowIsAbsentHrAccount() throws Exception {
        String body = given().header("Authorization", "Bearer " + token("sub-nobody")).when().get(PATH).then().statusCode(200)
                .extract().asString();
        assertEquals("absent-hr-account", GoldenFixture.JSON.readTree(body).get("value").get("state").asText());
    }

    @Test
    void readinessNamesTheRepositoryProvider() {
        given().when().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'account-port' }.data.provider", equalTo("repository"));
    }
}
