package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

/** The stock route gates that need no database: role, query and persistence (hr-snapshot, no datasource). */
@QuarkusTest
@TestProfile(AccountHttpProfile.class)
class ManualStockNoDatabaseHttpTest {

    private static final String PATH = "/api/gcsp/v1/manual/stock";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    private RequestSpecification as(String sub, String role) throws Exception {
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
        return given().header("Authorization", "Bearer " + jws.getCompactSerialization());
    }

    @Test
    void withoutADatabaseTheRouteIsPersistenceNotConfigured() throws Exception {
        as("sub-paula", "employee").when().get(PATH).then().statusCode(503).body("status", equalTo("unavailable"))
                .body("code", equalTo("persistence-not-configured")).body("retryable", equalTo(false))
                .body(not(containsString("value")));
    }

    @Test
    void onlyAnEmployeeMayBrowseAndAnyQueryIsRefused() throws Exception {
        as("sub-greg", "greg").when().get(PATH).then().statusCode(403).body("code", equalTo("role-required"));
        as("sub-presenter", "presenter").when().get(PATH).then().statusCode(403).body("code", equalTo("role-required"));
        given().when().get(PATH).then().statusCode(401).body("code", equalTo("bearer-missing"));
        as("sub-paula", "employee").when().get(PATH + "?employeeId=employee-jordan").then().statusCode(400)
                .body("status", equalTo("invalid")).body("code", equalTo("unsupported-query"))
                .body(not(containsString("employee-jordan")));
    }
}
