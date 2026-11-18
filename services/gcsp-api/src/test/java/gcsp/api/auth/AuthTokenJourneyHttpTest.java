package gcsp.api.auth;

import static gcsp.api.auth.AuthSupport.API;
import static gcsp.api.auth.AuthSupport.call;
import static gcsp.api.auth.AuthSupport.claims;
import static gcsp.api.auth.AuthSupport.sign;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.NumericDate;
import org.jose4j.keys.HmacKey;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-455 AC2: bad tokens fail explicitly on a real employee route, account switches and a presenter reset rebind. */
@QuarkusTest
@TestProfile(AuthRouteTableProfile.class)
class AuthTokenJourneyHttpTest {

    private static final String ROUTE = API + "/manual/account";
    private static final String CONTEXT = API + "/context";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    private RsaJsonWebKey key;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        key = AuthSupport.key(signingJwk);
    }

    private static String b64(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private void refused(String token, int http, String code) {
        call(token, "GET", ROUTE, null).then().statusCode(http).body("code", equalTo(code))
                .body("$", not(hasKey("value")));
    }

    private JwtClaims employeeClaims() {
        return claims("sub-paula", "employee");
    }

    @Test
    void badTokensFailExplicitlyOnARealRoute() throws Exception {
        JwtClaims expired = employeeClaims();
        expired.setExpirationTime(NumericDate.fromSeconds(NumericDate.now().getValue() - 120));
        refused(sign(expired, key), 401, "token-expired");
        JwtClaims audience = employeeClaims();
        audience.setAudience("someone-else");
        refused(sign(audience, key), 401, "token-audience-invalid");
        JwtClaims issuer = employeeClaims();
        issuer.setIssuer("https://other.test/realms/gcsp");
        refused(sign(issuer, key), 401, "token-issuer-invalid");
        refused(sign(employeeClaims(), RsaJwkGenerator.generateJwk(2048)), 401, "token-signature-invalid");
        refused(b64("{\"alg\":\"none\"}") + "." + b64(employeeClaims().toJson()) + ".", 401, "token-algorithm-unsupported");
        JsonWebSignature hmac = new JsonWebSignature();
        hmac.setPayload(employeeClaims().toJson());
        hmac.setKey(new HmacKey(new byte[32]));
        hmac.setAlgorithmHeaderValue(AlgorithmIdentifiers.HMAC_SHA256);
        refused(hmac.getCompactSerialization(), 401, "token-algorithm-unsupported");
        JwtClaims scope = employeeClaims();
        scope.setClaim("scope", "openid profile");
        refused(sign(scope, key), 403, "scope-missing");
        refused(sign(claims("sub-stranger", "employee"), key), 403, "subject-not-mapped");
    }

    @Test
    void switchingAccountsChangesTheContextWithoutManufacturingEmployeeRoles() throws Exception {
        String a = AuthSupport.token(signingJwk, "sub-employee-a", "employee");
        String b = AuthSupport.token(signingJwk, "sub-employee-b", "employee");
        String greg = AuthSupport.token(signingJwk, "sub-greg", "greg");
        String gregClaimingEmployee = AuthSupport.token(signingJwk, "sub-greg-only", "employee", "greg");
        call(a, "GET", CONTEXT, null).then().statusCode(200).body("value.employeeId", equalTo("E-1001"));
        call(b, "GET", CONTEXT, null).then().statusCode(200).body("value.subject", equalTo("sub-employee-b"))
                .body("value.employeeId", equalTo("E-1002"));
        call(greg, "GET", CONTEXT, null).then().statusCode(200).body("value.roles", equalTo(List.of("greg")))
                .body("value", not(hasKey("employeeId")));
        call(greg, "GET", ROUTE, null).then().statusCode(403).body("code", equalTo("role-required"));
        call(a, "GET", CONTEXT, null).then().statusCode(200).body("value.employeeId", equalTo("E-1001"));
        call(gregClaimingEmployee, "GET", CONTEXT, null).then().statusCode(200)
                .body("value.roles", equalTo(List.of("greg"))).body("value", not(hasKey("employeeId")));
        call(gregClaimingEmployee, "GET", ROUTE, null).then().statusCode(403).body("code", equalTo("role-required"));
    }

    @Test
    void anOldTokenIsReboundToTheNewActiveRunAfterAPresenterReset() throws Exception {
        String old = AuthSupport.token(signingJwk, "sub-paula", "employee");
        String presenter = AuthSupport.token(signingJwk, "sub-presenter", "presenter");
        JwtClaims lapsed = employeeClaims();
        lapsed.setExpirationTime(NumericDate.fromSeconds(NumericDate.now().getValue() - 120));
        String expired = sign(lapsed, key);
        String before = call(old, "GET", CONTEXT, null).then().statusCode(200).extract().jsonPath().getString("value.runId");
        String active = call(presenter, "GET", API + "/presenter/scenarios/current", null).then().statusCode(200).extract()
                .jsonPath().getString("value.runId");
        assertEquals(active, before, "the context starts on the active run");
        String activated = call(presenter, "POST", API + "/presenter/scenarios/reset", resetBody(presenter, active)).then()
                .statusCode(200).extract().jsonPath().getString("value.activatedRunId");
        assertNotEquals(before, activated);
        assertTrue(activated.startsWith("demo-"));
        call(old, "GET", CONTEXT, null).then().statusCode(200).body("value.runId", equalTo(activated))
                .body("value.employeeId", equalTo("employee-paula"));
        Response routed = call(old, "GET", ROUTE, null);
        assertTrue(routed.statusCode() != 401 && routed.statusCode() != 403, "old token on the new run: " + routed.statusCode());
        refused(expired, 401, "token-expired");
    }

    private String resetBody(String presenter, String run) {
        JsonPath catalogue = call(presenter, "GET", API + "/presenter/scenarios", null).jsonPath();
        String scenario = "gcsp-clock-scenario-v1";
        String base = "value.scenarios.find { it.scenarioId == '" + scenario + "' }.";
        return "{\"commandId\":\"cmd-" + UUID.randomUUID() + "\",\"expectedRunId\":\"" + run + "\",\"scenarioId\":\"" + scenario
                + "\",\"scenarioVersion\":\"" + catalogue.getString(base + "scenarioVersion") + "\",\"fixtureVersion\":\""
                + catalogue.getString(base + "fixtureVersion") + "\",\"policyVersion\":\""
                + catalogue.getString(base + "policyVersion") + "\"}";
    }
}
