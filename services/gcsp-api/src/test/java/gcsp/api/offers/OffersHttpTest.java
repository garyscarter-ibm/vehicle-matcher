package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

import gcsp.api.offers.OfferRecords.OfferRecord;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import java.time.Instant;
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

/** The offers endpoints with real signed tokens and an in-memory record port; no database. */
@QuarkusTest
@TestProfile(OffersTestProfile.class)
class OffersHttpTest {

    private static final String BASE = "/api/gcsp/v1/offers";
    private static final String HEX_A = "a".repeat(64);
    private static final String HEX_B = "b".repeat(64);
    private static final String MINE = "buddy-offer:" + HEX_A;
    private static final String THEIRS = "buddy-offer:" + HEX_B;
    private static final String OLD = "buddy-offer:" + "c".repeat(64);
    private static final String LAPSED = "buddy-offer:" + "d".repeat(64);

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    private RsaJsonWebKey key;

    @BeforeEach
    void seed() throws Exception {
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        Instant now = Instant.now();
        put(MINE, "E-1001", "active", "active", now.plusSeconds(3600), now.minusSeconds(10));
        put(THEIRS, "E-1002", "active", "active", now.plusSeconds(3600), now.minusSeconds(20));
        put(LAPSED, "E-1001", "expired", "expired", now.minusSeconds(60), now.minusSeconds(30));
        OffersTestPorts.STALE.add(OLD);
    }

    @AfterEach
    void clean() {
        OffersTestPorts.OFFERS.clear();
        OffersTestPorts.STALE.clear();
    }

    private static void put(String id, String employee, String state, String hold, Instant expires, Instant created) {
        OffersTestPorts.OFFERS.put(id, new OfferRecord(id, employee, "buddy-hold:" + HEX_A, hold, "buddy-quote:" + HEX_A,
                "order-1", "config-1", state, expires, 4, 2, created, "policy-1", "brief-1", created.minusSeconds(5),
                expires, 350, "MINI Cooper", "/img/mini.jpg", "eligible"));
    }

    private String token(String subject, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(OffersTestProfile.ISSUER);
        c.setAudience(OffersTestProfile.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", OffersTestProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private ValidatableResponse get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).when().get(BASE + path).then();
    }

    private String ownerToken() throws Exception {
        return token("sub-employee-a", "employee");
    }

    @Test
    void noBearerIsRefusedAsJsonWithSecurityHeaders() {
        given().when().get(BASE + "/" + MINE).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing")).header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer");
        given().when().get(BASE + "/current").then().statusCode(401);
    }

    @Test
    void ownerReadsTheOfferWithItsState() throws Exception {
        get(ownerToken(), "/" + MINE).statusCode(200).body("status", equalTo("ok"))
                .body("value.offerId", equalTo(MINE)).body("value.state", equalTo("pending"))
                .body("value.reason", equalTo("awaiting-decision"))
                .body("value.availableActions", hasSize(2)).body("value.quote.vehicleName", equalTo("MINI Cooper"))
                .body("value.offerVersion", equalTo(4)).body("value.schemaVersion", equalTo(1))
                .body("value.holdId", org.hamcrest.Matchers.nullValue())
                .body("value.employeeId", org.hamcrest.Matchers.nullValue())
                .header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    }

    @Test
    void anotherEmployeeIsRefusedWithoutFacts() throws Exception {
        String body = get(token("sub-employee-b", "employee"), "/" + MINE).statusCode(403)
                .body("status", equalTo("forbidden")).body("code", equalTo("offer-not-owned"))
                .header("Cache-Control", "no-store").extract().asString();
        org.junit.jupiter.api.Assertions.assertFalse(body.contains(MINE));
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("MINI"));
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("pending"));
    }

    @Test
    void presenterAndGregAreRefused() throws Exception {
        get(token("sub-presenter", "presenter"), "/" + MINE).statusCode(403).body("code", equalTo("role-required"));
        get(token("sub-greg", "greg"), "/" + MINE).statusCode(403).body("code", equalTo("role-required"));
        get(token("sub-presenter", "presenter"), "/current").statusCode(403);
    }

    @Test
    void invalidReferenceIsRefused() throws Exception {
        get(ownerToken(), "/" + "x".repeat(129)).statusCode(400).body("code", equalTo("invalid-offer-reference"));
        get(ownerToken(), "/bad%20id").statusCode(400).body("code", equalTo("invalid-offer-reference"));
    }

    @Test
    void unknownIsNotFoundAndStaleIsConflict() throws Exception {
        get(ownerToken(), "/buddy-offer:" + "9".repeat(64)).statusCode(404).body("code", equalTo("offer-not-found"))
                .body("retryable", equalTo(false));
        get(ownerToken(), "/" + OLD).statusCode(409).body("status", equalTo("stale-run"))
                .body("code", equalTo("offer-from-earlier-run"));
    }

    @Test
    void expiredOfferIsAReadableState() throws Exception {
        get(ownerToken(), "/" + LAPSED).statusCode(200).body("value.state", equalTo("expired"))
                .body("value.availableActions", hasSize(0));
    }

    @Test
    void queryParametersAreRefused() throws Exception {
        get(ownerToken(), "/" + MINE + "?token=abc").statusCode(400).body("code", equalTo("unsupported-query"));
        get(ownerToken(), "/current?employeeId=E-1002").statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    void currentListsOnlyTheOwnersOffers() throws Exception {
        get(ownerToken(), "/current").statusCode(200).body("value.offers", hasSize(2))
                .body("value.offers[0].offerId", equalTo(MINE)).body("value.offers[1].offerId", equalTo(LAPSED))
                .body("value.offers.offerId", not(org.hamcrest.Matchers.hasItem(THEIRS)))
                .header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    }

    @Test
    void noWriteOrExchangeRoutesExist() throws Exception {
        given().header("Authorization", "Bearer " + ownerToken()).when().post(BASE + "/access").then()
                .statusCode(org.hamcrest.Matchers.anyOf(equalTo(404), equalTo(405)));
        given().header("Authorization", "Bearer " + ownerToken()).when().post(BASE + "/" + MINE).then()
                .statusCode(org.hamcrest.Matchers.anyOf(equalTo(404), equalTo(405)));
    }
}
