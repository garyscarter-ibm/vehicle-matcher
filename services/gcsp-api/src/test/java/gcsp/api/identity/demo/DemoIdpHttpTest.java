package gcsp.api.identity.demo;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.consumer.JwtConsumerBuilder;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The demo issuer end to end over HTTP: the code and PKCE flow, refresh, end-session, and the API's own validator. */
@QuarkusTest
@TestProfile(DemoIssuerProfile.class)
class DemoIdpHttpTest {

    private static final String ISSUER_PATH = "/demo-idp";
    private static final String VERIFIER = "a-long-enough-pkce-verifier-for-the-demo-issuer-tests-0123456789";
    private static final Pattern TXN = Pattern.compile("name=\"txn\" value=\"([^\"]+)\"");

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(DemoIssuerProfile.databaseConfigured(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @AfterAll
    static void drop() throws Exception {
        DemoIssuerProfile.dropSchema();
    }

    private static String challenge(String verifier) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    }

    private static Map<String, String> authorizeParams(String challenge) {
        Map<String, String> p = new HashMap<>();
        p.put("client_id", DemoIssuerProfile.CLIENT);
        p.put("redirect_uri", DemoIssuerProfile.REDIRECT);
        p.put("response_type", "code");
        p.put("scope", "openid profile gcsp-api");
        p.put("state", "st-1");
        p.put("nonce", "nonce-1");
        p.put("code_challenge", challenge);
        p.put("code_challenge_method", "S256");
        return p;
    }

    private static Response authorizePage(Map<String, String> params) {
        return given().redirects().follow(false).queryParams(params).get(ISSUER_PATH + "/authorize");
    }

    private static String txnOf(Response page) {
        Matcher m = TXN.matcher(page.asString());
        assertTrue(m.find(), "the page carries a transaction");
        return m.group(1);
    }

    private static Map<String, String> query(String location) {
        Map<String, String> out = new HashMap<>();
        String q = URI.create(location).getRawQuery();
        if (q == null) return out;
        for (String pair : q.split("&")) {
            int i = pair.indexOf('=');
            out.put(pair.substring(0, i), URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
        }
        return out;
    }

    @Test
    void personFormPostedFromTheIssuerOriginIsNotRefusedByCors() {
        String issuer = given().get(ISSUER_PATH + "/.well-known/openid-configuration").path("issuer");
        String origin = issuer.substring(0, issuer.length() - ISSUER_PATH.length());
        String txn = txnOf(authorizePage(authorizeParams("x".repeat(43))));
        given().redirects().follow(false).header("Origin", origin).formParam("txn", txn)
                .formParam("subject", "demo-paula").post(ISSUER_PATH + "/authorize").then().statusCode(302);
    }

    /** Chooses a person and returns the callback code. */
    private static String chooseCode(String subject, String challenge) {
        String txn = txnOf(authorizePage(authorizeParams(challenge)));
        Response r = given().redirects().follow(false).formParam("txn", txn).formParam("subject", subject)
                .post(ISSUER_PATH + "/authorize");
        r.then().statusCode(302);
        String location = r.header("Location");
        assertTrue(location.startsWith(DemoIssuerProfile.REDIRECT + "?"), location);
        Map<String, String> q = query(location);
        assertEquals("st-1", q.get("state"));
        return q.get("code");
    }

    private static Response exchange(String code, String verifier) {
        return given().formParam("grant_type", "authorization_code").formParam("client_id", DemoIssuerProfile.CLIENT)
                .formParam("redirect_uri", DemoIssuerProfile.REDIRECT).formParam("code", code)
                .formParam("code_verifier", verifier).post(ISSUER_PATH + "/token");
    }

    private static Response refresh(String refreshToken) {
        return given().formParam("grant_type", "refresh_token").formParam("client_id", DemoIssuerProfile.CLIENT)
                .formParam("refresh_token", refreshToken).post(ISSUER_PATH + "/token");
    }

    /** A full sign-in as one person; the token response. */
    private static Response signIn(String subject) throws Exception {
        Response r = exchange(chooseCode(subject, challenge(VERIFIER)), VERIFIER);
        r.then().statusCode(200);
        return r;
    }

    private static io.restassured.response.ValidatableResponse context(String accessToken) {
        return given().header("Authorization", "Bearer " + accessToken).get("/api/gcsp/v1/context").then();
    }

    @Test
    void discoveryDescribesTheIssuerAndIsReachableFromTheWebOrigin() {
        String base = given().get(ISSUER_PATH + "/.well-known/openid-configuration").path("issuer");
        given().header("Origin", "https://frontend.test").get(ISSUER_PATH + "/.well-known/openid-configuration").then()
                .statusCode(200).contentType(containsString("application/json"))
                .header("Access-Control-Allow-Origin", "https://frontend.test")
                .body("issuer", equalTo(base))
                .body("authorization_endpoint", equalTo(base + "/authorize"))
                .body("token_endpoint", equalTo(base + "/token"))
                .body("jwks_uri", equalTo(base + "/jwks"))
                .body("end_session_endpoint", equalTo(base + "/end-session"))
                .body("response_types_supported", equalTo(List.of("code")))
                .body("grant_types_supported", equalTo(List.of("authorization_code", "refresh_token")))
                .body("code_challenge_methods_supported", equalTo(List.of("S256")))
                .body("token_endpoint_auth_methods_supported", equalTo(List.of("none")))
                .body("subject_types_supported", equalTo(List.of("public")))
                .body("id_token_signing_alg_values_supported", equalTo(List.of("RS256")))
                .body("scopes_supported", hasItems("openid", "profile", "gcsp-api"));
        assertTrue(base.endsWith(ISSUER_PATH));
    }

    @Test
    void jwksPublishesThePublicKeyOnly() {
        given().header("Origin", "https://frontend.test").get(ISSUER_PATH + "/jwks").then().statusCode(200)
                .header("Access-Control-Allow-Origin", "https://frontend.test")
                .body("keys", hasSize(1)).body("keys[0].kty", equalTo("RSA")).body("keys[0].alg", equalTo("RS256"))
                .body("keys[0].use", equalTo("sig")).body("keys[0].kid", notNullValue()).body("keys[0].d", nullValue());
    }

    @Test
    void signInPageIsLabelledListsEveryoneAndIsLockedDown() {
        Response page = authorizePage(authorizeParams(VERIFIER_CHALLENGE));
        page.then().statusCode(200).contentType(containsString("text/html"))
                .header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "same-origin")
                .header("Cache-Control", "no-store");
        String csp = page.header("Content-Security-Policy");
        assertTrue(csp.contains("default-src 'none'") && csp.contains("style-src 'self'")
                && csp.contains("form-action 'self' http://localhost:4300") && csp.contains("frame-ancestors 'none'")
                && csp.contains("base-uri 'none'"), csp);
        String html = page.asString();
        assertTrue(html.contains("<title>Demo sign-in. Fictional people only.</title>"));
        assertTrue(html.contains("<h1>Demo sign-in. Fictional people only.</h1>"));
        assertTrue(html.contains("No password is needed."));
        assertFalse(html.contains("—"), "no em dash");
        assertFalse(html.contains("<script"), "no script");
        int last = -1;
        for (DemoPerson p : DemoSupport.PEOPLE) {
            int at = html.indexOf("data-subject=\"" + p.principalId() + "\"");
            assertTrue(at > last, "person listed in order: " + p.principalId());
            last = at;
            assertTrue(html.contains(p.name()));
        }
        assertTrue(html.contains("Ordering lead and employee"));
        assertTrue(html.contains(">Presenter<"));
        assertTrue(html.contains("action=\"http://localhost:"));
        given().get(ISSUER_PATH + "/demo-idp.css").then().statusCode(200).contentType(containsString("text/css"))
                .body(containsString("outline: 3px solid")).body(containsString("--control: 48px"))
                .header("X-Content-Type-Options", "nosniff");
    }

    private static final String VERIFIER_CHALLENGE;

    static {
        try {
            VERIFIER_CHALLENGE = challenge(VERIFIER);
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @Test
    void codeAndPkceFlowSignsInPaulaAndTheApiAcceptsTheToken() throws Exception {
        Response t = signIn("demo-paula");
        t.then().header("Cache-Control", "no-store").body("token_type", equalTo("Bearer"))
                .body("expires_in", equalTo(600)).body("scope", containsString("gcsp-api"))
                .body("refresh_token", notNullValue());
        context(t.path("access_token")).statusCode(200).body("status", equalTo("ok"))
                .body("value.subject", equalTo("demo-paula")).body("value.roles", equalTo(List.of("employee")))
                .body("value.employeeId", equalTo("employee-paula"));
        JwtClaims id = new JwtConsumerBuilder().setSkipAllValidators().setDisableRequireSignature()
                .setSkipSignatureVerification().build().processToClaims(t.path("id_token"));
        assertEquals("Paula Mason", id.getClaimValueAsString("name"));
        assertEquals("nonce-1", id.getClaimValueAsString("nonce"));
        assertEquals("demo-paula", id.getSubject());
        assertNotNull(id.getClaimValueAsString("sid"));
    }

    @Test
    void thePresenterAndGregSignInWithTheirOwnRoles() throws Exception {
        context(signIn("demo-presenter").path("access_token")).statusCode(200)
                .body("value.roles", equalTo(List.of("presenter"))).body("value.employeeId", nullValue());
        context(signIn("demo-greg").path("access_token")).statusCode(200).body("value.subject", equalTo("demo-greg"))
                .body("value.roles", hasItems("greg", "employee"));
    }

    @Test
    void aWrongPkceVerifierIsRefusedAndSpendsTheCode() throws Exception {
        String code = chooseCode("demo-paula", challenge(VERIFIER));
        exchange(code, VERIFIER + "-wrong").then().statusCode(400).body("error", equalTo("invalid_grant"));
        exchange(code, VERIFIER).then().statusCode(400).body("error", equalTo("invalid_grant"));
    }

    @Test
    void aCodeCannotBeUsedTwice() throws Exception {
        String code = chooseCode("demo-paula", challenge(VERIFIER));
        exchange(code, VERIFIER).then().statusCode(200);
        exchange(code, VERIFIER).then().statusCode(400).body("error", equalTo("invalid_grant"));
    }

    @Test
    void aDifferentRedirectAtTheTokenEndpointIsRefused() throws Exception {
        String code = chooseCode("demo-paula", challenge(VERIFIER));
        given().formParam("grant_type", "authorization_code").formParam("client_id", DemoIssuerProfile.CLIENT)
                .formParam("redirect_uri", "http://localhost:4300/elsewhere").formParam("code", code)
                .formParam("code_verifier", VERIFIER).post(ISSUER_PATH + "/token").then().statusCode(400)
                .body("error", equalTo("invalid_grant"));
    }

    @Test
    void tokenEndpointRefusesUnknownClientsAndOtherGrants() {
        given().formParam("grant_type", "authorization_code").formParam("client_id", "someone-else")
                .post(ISSUER_PATH + "/token").then().statusCode(400).body("error", equalTo("invalid_client"));
        given().formParam("grant_type", "password").formParam("client_id", DemoIssuerProfile.CLIENT)
                .post(ISSUER_PATH + "/token").then().statusCode(400).body("error", equalTo("unsupported_grant_type"));
        refresh("not-a-token").then().statusCode(400).body("error", equalTo("invalid_grant"));
    }

    @Test
    void anUnknownClientIsShownAnErrorAndNeverRedirected() {
        Map<String, String> p = authorizeParams(VERIFIER_CHALLENGE);
        p.put("client_id", "someone-else");
        Response r = authorizePage(p);
        r.then().statusCode(400).header("Location", nullValue());
        assertTrue(r.asString().contains("could not continue"));
    }

    @Test
    void anUnregisteredRedirectIsShownAnErrorAndNeverRedirected() {
        Map<String, String> p = authorizeParams(VERIFIER_CHALLENGE);
        p.put("redirect_uri", "http://localhost:4300/gcsp/auth/callback/../evil");
        authorizePage(p).then().statusCode(400).header("Location", nullValue());
        p.put("redirect_uri", "https://evil.example/cb");
        authorizePage(p).then().statusCode(400).header("Location", nullValue());
    }

    @Test
    void plainPkceAndOtherBadRequestsRedirectBackWithAnError() {
        Map<String, String> p = authorizeParams(VERIFIER_CHALLENGE);
        p.put("code_challenge_method", "plain");
        Response r = authorizePage(p);
        r.then().statusCode(302);
        Map<String, String> q = query(r.header("Location"));
        assertEquals("invalid_request", q.get("error"));
        assertEquals("st-1", q.get("state"));
        p = authorizeParams(VERIFIER_CHALLENGE);
        p.remove("state");
        authorizePage(p).then().statusCode(302);
        p = authorizeParams(VERIFIER_CHALLENGE);
        p.put("scope", "profile");
        authorizePage(p).then().statusCode(302);
        p = authorizeParams("");
        authorizePage(p).then().statusCode(302);
    }

    @Test
    void chooseRefusesAnUnknownTransactionAndAnUnknownPerson() throws Exception {
        given().redirects().follow(false).formParam("txn", "nope").formParam("subject", "demo-paula")
                .post(ISSUER_PATH + "/authorize").then().statusCode(400).header("Location", nullValue());
        String txn = txnOf(authorizePage(authorizeParams(VERIFIER_CHALLENGE)));
        given().redirects().follow(false).formParam("txn", txn).formParam("subject", "someone-new")
                .post(ISSUER_PATH + "/authorize").then().statusCode(400).header("Location", nullValue());
        given().redirects().follow(false).formParam("txn", txn).formParam("subject", "demo-paula")
                .post(ISSUER_PATH + "/authorize").then().statusCode(302);
        given().redirects().follow(false).formParam("txn", txn).formParam("subject", "demo-paula")
                .post(ISSUER_PATH + "/authorize").then().statusCode(400);
    }

    @Test
    void refreshRotatesTheTokenAndRefusesReuse() throws Exception {
        Response first = signIn("demo-paula");
        String oldRefresh = first.path("refresh_token");
        Response renewed = refresh(oldRefresh);
        renewed.then().statusCode(200).header("Cache-Control", "no-store").body("id_token", notNullValue());
        assertNotEquals(oldRefresh, renewed.path("refresh_token"));
        context(renewed.path("access_token")).statusCode(200).body("value.employeeId", equalTo("employee-paula"));
        refresh(oldRefresh).then().statusCode(400).body("error", equalTo("invalid_grant"));
        refresh(renewed.path("refresh_token")).then().statusCode(200);
    }

    @Test
    void endSessionEndsTheSessionSoAnotherPersonCanSignIn() throws Exception {
        Response paula = signIn("demo-paula");
        given().redirects().follow(false).queryParam("id_token_hint", paula.<String>path("id_token"))
                .queryParam("post_logout_redirect_uri", DemoIssuerProfile.POST_LOGOUT).queryParam("state", "bye")
                .get(ISSUER_PATH + "/end-session").then().statusCode(302)
                .header("Location", equalTo(DemoIssuerProfile.POST_LOGOUT + "?state=bye"));
        refresh(paula.path("refresh_token")).then().statusCode(400).body("error", equalTo("invalid_grant"));
        context(signIn("demo-greg").path("access_token")).statusCode(200).body("value.subject", equalTo("demo-greg"));
    }

    @Test
    void endSessionWithoutStateRedirectsPlainly() throws Exception {
        Response paula = signIn("demo-paula");
        given().redirects().follow(false).queryParam("id_token_hint", paula.<String>path("id_token"))
                .queryParam("post_logout_redirect_uri", DemoIssuerProfile.POST_LOGOUT)
                .get(ISSUER_PATH + "/end-session").then().statusCode(302)
                .header("Location", equalTo(DemoIssuerProfile.POST_LOGOUT));
    }

    @Test
    void endSessionRefusesABadHintOrAnUnregisteredReturnAddress() throws Exception {
        Response paula = signIn("demo-paula");
        String good = paula.path("id_token");
        given().redirects().follow(false).queryParam("id_token_hint", "garbage")
                .queryParam("post_logout_redirect_uri", DemoIssuerProfile.POST_LOGOUT)
                .get(ISSUER_PATH + "/end-session").then().statusCode(400).header("Location", nullValue());
        given().redirects().follow(false).queryParam("post_logout_redirect_uri", DemoIssuerProfile.POST_LOGOUT)
                .get(ISSUER_PATH + "/end-session").then().statusCode(400).header("Location", nullValue());
        given().redirects().follow(false).queryParam("id_token_hint", good)
                .queryParam("post_logout_redirect_uri", "https://evil.example/").get(ISSUER_PATH + "/end-session")
                .then().statusCode(400).header("Location", nullValue());
        given().redirects().follow(false).queryParam("id_token_hint", forged(good))
                .queryParam("post_logout_redirect_uri", DemoIssuerProfile.POST_LOGOUT)
                .get(ISSUER_PATH + "/end-session").then().statusCode(400).header("Location", nullValue());
        refresh(paula.path("refresh_token")).then().statusCode(200);
    }

    /** The same claims signed by a key the issuer never published. */
    private static String forged(String token) throws Exception {
        JwtClaims claims = new JwtConsumerBuilder().setSkipAllValidators().setDisableRequireSignature()
                .setSkipSignatureVerification().build().processToClaims(token);
        RsaJsonWebKey other = RsaJwkGenerator.generateJwk(2048);
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(other.getPrivateKey());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    @Test
    void aTokenSignedByAnotherKeyIsRefusedByTheApi() throws Exception {
        String forged = forged(signIn("demo-paula").path("access_token"));
        context(forged).statusCode(401);
    }
}
