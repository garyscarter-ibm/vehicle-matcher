package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
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
import org.junit.jupiter.api.Test;

/** A principal bound to a run other than the active one is refused with 409 stale-run on the stock route. */
@QuarkusTest
@TestProfile(ManualStockStaleRunHttpTest.Profile.class)
class ManualStockStaleRunHttpTest {

    public static class Profile extends RepositoryHttpProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = new HashMap<>(super.getConfigOverrides());
            c.put("gcsp.environment.run-id", "run-0");
            return c;
        }
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Test
    void aSessionFromAnotherRunIsStale() throws Exception {
        Assumptions.assumeTrue(RepositoryHttpProfile.URL != null && !RepositoryHttpProfile.URL.isBlank(),
                "GCSP_TEST_DATABASE_URL is not set");
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(AccountHttpProfile.ISSUER);
        c.setAudience(AccountHttpProfile.AUDIENCE);
        c.setSubject("sub-paula");
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
        given().header("Authorization", "Bearer " + jws.getCompactSerialization()).when()
                .get("/api/gcsp/v1/manual/stock").then().statusCode(409).body("code", equalTo("stale-run"));
    }
}
