package gcsp.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.NumericDate;
import org.jose4j.keys.HmacKey;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** GET /api/gcsp/v1/context with real RS256 JWTs signed by the key the test JWKS server publishes. */
@QuarkusTest
@TestProfile(OidcTestProfile.class)
class OidcContextTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    private RsaJsonWebKey key;

    @BeforeEach
    void loadKey() throws Exception {
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
    }

    private JwtClaims claims(String sub, String... roles) {
        JwtClaims c = new JwtClaims();
        c.setIssuer(OidcTestProfile.ISSUER);
        c.setAudience(OidcTestProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", OidcTestProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(roles)));
        return c;
    }

    private String sign(JwtClaims c, RsaJsonWebKey signer) throws Exception {
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(signer.getPrivateKey());
        jws.setKeyIdHeaderValue(JwksServerResource.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private String sign(JwtClaims c) throws Exception {
        return sign(c, key);
    }

    private ValidatableResponse call(String token) {
        return given().header("Authorization", "Bearer " + token).when().get("/api/gcsp/v1/context").then();
    }

    private void refused401(String token, String code) {
        call(token).statusCode(401).header("WWW-Authenticate", "Bearer")
                .contentType(containsString("application/json"))
                .body("status", equalTo("unauthenticated")).body("code", equalTo(code))
                .body(not(containsString(token)));
    }

    private void refused403(String token, String code) {
        call(token).statusCode(403).body("status", equalTo("forbidden")).body("code", equalTo(code))
                .body("$", not(hasKey("value"))).body(not(containsString("employeeId")));
    }

    private static String b64(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void employeeGetsContextWithoutTokenEcho() throws Exception {
        String token = sign(claims("sub-employee-a", "employee"));
        Map<String, Object> body = call(token).statusCode(200).body(not(containsString(token)))
                .body(not(containsString("token"))).extract().jsonPath().getMap("$");
        org.junit.jupiter.api.Assertions.assertEquals(Map.of(
                "status", "ok",
                "value", Map.of(
                        "subject", "sub-employee-a",
                        "roles", List.of("employee"),
                        "environmentId", "isolated-dev",
                        "runId", "test-run-1",
                        "employeeId", "E-1001",
                        "policyVersion", "test-policy-1",
                        "capabilities", List.of("account:read"))), body);
    }

    @Test
    void gregHasNoEmployeeId() throws Exception {
        call(sign(claims("sub-greg", "greg"))).statusCode(200)
                .body("value.roles", equalTo(List.of("greg")))
                .body("value.capabilities", equalTo(List.of("greg:read", "comparison:command")))
                .body("value", not(hasKey("employeeId")));
    }

    @Test
    void presenterHasNoEmployeeId() throws Exception {
        call(sign(claims("sub-presenter", "presenter"))).statusCode(200)
                .body("value.roles", equalTo(List.of("presenter")))
                .body("value", not(hasKey("employeeId")));
    }

    @Test
    void presenterTokenClaimingMoreRolesStaysPresenterOnly() throws Exception {
        call(sign(claims("sub-presenter", "employee", "greg", "presenter"))).statusCode(200)
                .body("value.roles", equalTo(List.of("presenter")))
                .body("value", not(hasKey("employeeId")));
    }

    @Test
    void tokenRoleOutsideTheMappingIsNotGranted() throws Exception {
        refused403(sign(claims("sub-greg-only", "employee")), "role-not-granted");
    }

    @Test
    void wrongIssuer() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setIssuer("https://other.test/realms/gcsp");
        refused401(sign(c), "token-issuer-invalid");
    }

    @Test
    void wrongAudience() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setAudience("someone-else");
        refused401(sign(c), "token-audience-invalid");
    }

    @Test
    void idTokenLikeAudienceIsRefused() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setAudience(OidcTestProfile.CLIENT);
        refused401(sign(c), "token-audience-invalid");
    }

    @Test
    void expired() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setExpirationTime(NumericDate.fromSeconds(NumericDate.now().getValue() - 120));
        refused401(sign(c), "token-expired");
    }

    @Test
    void notYetValid() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setNotBefore(NumericDate.fromSeconds(NumericDate.now().getValue() + 120));
        refused401(sign(c), "token-not-yet-valid");
    }

    @Test
    void missingExpiry() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.unsetClaim("exp");
        refused401(sign(c), "token-lifetime-invalid");
    }

    @Test
    void missingSubject() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.unsetClaim("sub");
        refused401(sign(c), "token-subject-missing");
    }

    @Test
    void differentKeySameKid() throws Exception {
        RsaJsonWebKey other = RsaJwkGenerator.generateJwk(2048);
        refused401(sign(claims("sub-employee-a", "employee"), other), "token-signature-invalid");
    }

    @Test
    void tamperedPayload() throws Exception {
        String[] parts = sign(claims("sub-employee-a", "employee")).split("\\.");
        String forged = b64(claims("sub-employee-b", "employee").toJson());
        refused401(parts[0] + "." + forged + "." + parts[2], "token-signature-invalid");
    }

    @Test
    void algNone() {
        String token = b64("{\"alg\":\"none\"}") + "." + b64(claims("sub-employee-a", "employee").toJson()) + ".";
        refused401(token, "token-algorithm-unsupported");
    }

    @Test
    void hmacAlgorithm() throws Exception {
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims("sub-employee-a", "employee").toJson());
        jws.setKey(new HmacKey(new byte[32]));
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.HMAC_SHA256);
        refused401(jws.getCompactSerialization(), "token-algorithm-unsupported");
    }

    @Test
    void garbage() {
        refused401("not-a-jwt", "token-malformed");
        refused401("a.b.c", "token-malformed");
        refused401("a.b.c.d.e", "token-malformed");
    }

    @Test
    void wrongAuthorizedParty() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setClaim("azp", "other-client");
        refused401(sign(c), "token-client-invalid");
    }

    @Test
    void missingScope() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.setClaim("scope", "openid profile");
        refused403(sign(c), "scope-missing");
    }

    @Test
    void missingRoleClaim() throws Exception {
        JwtClaims c = claims("sub-employee-a", "employee");
        c.unsetClaim("realm_access");
        refused403(sign(c), "role-missing");
    }

    @Test
    void onlyUnknownRoles() throws Exception {
        refused403(sign(claims("sub-employee-a", "offline_access", "uma_authorization")), "role-missing");
    }

    @Test
    void unknownSubjectWithValidRoles() throws Exception {
        refused403(sign(claims("sub-stranger", "employee")), "subject-not-mapped");
    }

    @Test
    void switchingAccountsNeverReusesContext() throws Exception {
        String a = sign(claims("sub-employee-a", "employee"));
        JwtClaims expired = claims("sub-employee-a", "employee");
        expired.setExpirationTime(NumericDate.fromSeconds(NumericDate.now().getValue() - 120));
        String aExpired = sign(expired);
        call(a).statusCode(200).body("value.subject", equalTo("sub-employee-a"))
                .body("value.employeeId", equalTo("E-1001"));
        call(sign(claims("sub-employee-b", "employee"))).statusCode(200)
                .body("value.subject", equalTo("sub-employee-b")).body("value.employeeId", equalTo("E-1002"));
        call(a).statusCode(200).body("value.employeeId", equalTo("E-1001"));
        refused401(aExpired, "token-expired");
    }

    @Test
    void readinessReportsOidc() {
        given().when().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'identity-port' }.data.provider", equalTo("oidc"));
    }
}
