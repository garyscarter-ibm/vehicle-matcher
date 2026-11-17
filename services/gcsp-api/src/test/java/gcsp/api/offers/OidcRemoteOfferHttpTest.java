package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountSelection;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.IdentityPort;
import gcsp.api.ordering.OrderingServiceHolder;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.ValidatableResponse;
import jakarta.enterprise.inject.spi.BeanManager;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

/**
 * Real Quarkus/JWKS/HTTP/PG composition from a seeded remote-offered boundary, with a profile-scoped policy clock.
 * This is not claim production, browser login, email delivery, hosted/BMW proof or the full order-status HTTP journey.
 */
@QuarkusTest
@TestProfile(OidcRemoteOfferProfile.class)
class OidcRemoteOfferHttpTest {

    private static final String API = "/api/gcsp/v1";
    private static final String COMMAND = "oidc-remote-accept-1";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "gcsp.test.oidc-remote-offer.offer-id")
    String offerId;

    @Inject
    IdentityPort identity;

    @Inject
    RemoteBuddy buddy;

    @Inject
    AccountSelection accounts;

    @Inject
    OrderingServiceHolder ordering;

    @Inject
    BeanManager beans;

    @Inject
    AgroalDataSource dataSource;

    @Test
    void ownerJwtAcceptsThroughStartupSelectedRemoteBuddyAndReadsAcceptedOffer() throws Exception {
        assertEquals("oidc", identity.mode());
        assertEquals("remote", buddy.mode());
        assertEquals("repository", accounts.mode());
        assertEquals("synthetic", ordering.provider());
        var recordsBean = beans.resolve(beans.getBeans(OfferRecords.class));
        assertNotNull(recordsBean, "the application must resolve an offer-record bean");
        assertEquals(PostgresOfferRecords.class, recordsBean.getBeanClass(),
                "the globally enabled in-memory test alternative must be excluded");

        String path = API + "/offers/" + offerId;
        ObjectNode refusedAttempt = accept("unused-for-refused-caller", 1, 1);
        assertNoSelection();
        given().contentType("application/json").body(refusedAttempt.toString()).when().post(path + "/decision")
                .then().statusCode(401).body("code", equalTo("bearer-missing"));
        assertNoSelection();
        post(token("sub-employee-b"), path + "/decision", refusedAttempt).statusCode(403)
                .body("code", equalTo("offer-not-owned"));
        assertNoSelection();

        String owner = token("sub-employee-a");
        get(owner, API + "/context").statusCode(200).body("value.employeeId", equalTo(DecisionEnv.EMPLOYEE))
                .body("value.environmentId", equalTo(OffersPg.ENV)).body("value.runId", equalTo("run-1"));
        String termsDigest = get(owner, API + "/manual/order/terms").statusCode(200)
                .body("status", equalTo("ok")).extract().jsonPath().getString("value.termsDigest");
        assertNotNull(termsDigest);
        assertFalse(termsDigest.isBlank());
        JsonPath offered = get(owner, path).statusCode(200).body("value.offerId", equalTo(offerId))
                .body("value.state", equalTo("pending")).body("value.reason", equalTo("awaiting-decision"))
                .extract().jsonPath();

        // The remote protocol returns its stored pending receipt even when this inline drive converts immediately.
        String operationId = post(owner, path + "/decision", accept(termsDigest,
                offered.getLong("value.offerVersion"), offered.getLong("value.holdVersion")))
                .statusCode(202).body("status", equalTo("pending")).body("code", equalTo("decision-pending"))
                .body("retryable", equalTo(false)).body("offerId", equalTo(offerId))
                .body("commandId", equalTo(COMMAND)).body("$", not(hasKey("value")))
                .extract().jsonPath().getString("operationId");
        assertNotNull(operationId);
        assertFalse(operationId.isBlank());
        get(owner, path).statusCode(200).body("value.state", equalTo("accepted"))
                .body("value.reason", equalTo("accepted")).body("value.holdState", equalTo("allocated"))
                .body("value.availableActions", hasSize(0));

        assertEquals(1, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'accept' "
                + "AND command_id = ?", offerId, COMMAND));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders s JOIN buddy_offers o "
                + "ON o.environment_id = s.environment_id AND o.run_id = s.run_id AND o.order_uuid = s.order_uuid "
                + "WHERE o.offer_id = ? AND s.employee_id = ?", offerId, DecisionEnv.EMPLOYEE));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-selection'"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_id = ? "
                + "AND operation_type = 'offer-selection' AND state = 'acknowledged'", operationId));
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE state = 'allocated'"));
        assertEquals(1, count("SELECT count(*) FROM stock_cars WHERE state = 'allocated'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted' "
                + "AND event_id = 'offer-accepted:' || (SELECT hold_id FROM buddy_offers WHERE offer_id = ?)", offerId));
    }

    private void assertNoSelection() throws SQLException {
        assertEquals(0, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-selection'"));
    }

    private static ObjectNode accept(String termsDigest, long offerVersion, long holdVersion) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("commandId", COMMAND).put("decision", "accept").put("expectedOfferVersion", offerVersion)
                .put("expectedHoldVersion", holdVersion).put("termsDigest", termsDigest);
        body.putObject("declarations").put("terms", true).put("driver", true);
        return body;
    }

    private String token(String subject) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(OffersTestProfile.ISSUER);
        claims.setAudience(OffersTestProfile.AUDIENCE);
        claims.setSubject(subject);
        claims.setExpirationTimeMinutesInTheFuture(10);
        claims.setIssuedAtToNow();
        claims.setClaim("azp", OffersTestProfile.CLIENT);
        claims.setClaim("scope", "openid gcsp-api");
        claims.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static ValidatableResponse get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).when().get(path).then();
    }

    private static ValidatableResponse post(String token, String path, ObjectNode body) {
        return given().header("Authorization", "Bearer " + token).contentType("application/json")
                .body(body.toString()).when().post(path).then();
    }

    private long count(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getLong(1);
            }
        }
    }
}
