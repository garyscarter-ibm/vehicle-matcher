package gcsp.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
import org.junit.jupiter.api.Test;

/**
 * Key rotation and unknown-kid throttling over real signed JWTs. Its own profile gives it its own app, so no
 * other test class spends the refetch window first.
 */
@QuarkusTest
@TestProfile(OidcKeyRotationTest.Profile.class)
class OidcKeyRotationTest {

    /** A distinct profile class means its own app start, OidcIdentity and JWKS server. */
    public static class Profile extends OidcTestProfile {}

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "gcsp.test.rotation-jwk")
    String rotationJwk;

    @ConfigProperty(name = "gcsp.test.jwks-control")
    String control;

    private final HttpClient http = HttpClient.newHttpClient();

    private int control(String action) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(control + "/" + action)).build(),
                HttpResponse.BodyHandlers.ofString());
        return Integer.parseInt(r.body().trim());
    }

    private static String sign(RsaJsonWebKey signer, String kid) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(OidcTestProfile.ISSUER);
        c.setAudience(OidcTestProfile.AUDIENCE);
        c.setSubject("sub-employee-a");
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", OidcTestProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(signer.getPrivateKey());
        jws.setKeyIdHeaderValue(kid);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static int status(String token) {
        return given().header("Authorization", "Bearer " + token).when().get("/api/gcsp/v1/context")
                .then().extract().statusCode();
    }

    private static void refused401(String token) {
        given().header("Authorization", "Bearer " + token).when().get("/api/gcsp/v1/context").then()
                .statusCode(401).body("code", equalTo("token-signature-invalid"));
    }

    @Test
    void rotatedKeyIsAcceptedAndUnknownKidsAreThrottledTo401() throws Exception {
        RsaJsonWebKey first = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        RsaJsonWebKey second = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(rotationJwk);
        RsaJsonWebKey forger = RsaJwkGenerator.generateJwk(2048);

        assertEquals(200, status(sign(first, JwksServerResource.KID)));
        Thread.sleep(400); // past jose4j's own 300 ms refresh guard, so only the API's window is under test
        int loaded = control("rotate");

        assertEquals(200, status(sign(second, JwksServerResource.ROTATION_KID)), "rotated key accepted");
        int afterRotation = control("fetches");
        assertEquals(loaded + 1, afterRotation, "one refetch picks up the rotated key");

        for (int i = 0; i < 20; i++) {
            refused401(sign(forger, UUID.randomUUID().toString()));
        }
        for (int i = 0; i < 3; i++) {
            Thread.sleep(350);
            refused401(sign(forger, UUID.randomUUID().toString()));
        }
        assertEquals(afterRotation, control("fetches"), "unknown kids in the window cause no refetch");

        control("down");
        refused401(sign(forger, UUID.randomUUID().toString()));
        assertEquals(200, status(sign(first, JwksServerResource.KID)), "cached keys still verify");
        assertEquals(200, status(sign(second, JwksServerResource.ROTATION_KID)));
        assertEquals(afterRotation, control("fetches"), "no refetch while the JWKS is down");
    }
}
