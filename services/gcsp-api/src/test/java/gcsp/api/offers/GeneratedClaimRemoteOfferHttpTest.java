package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountSelection;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.allocation.Trigger;
import gcsp.api.identity.IdentityPort;
import gcsp.api.ordering.OrderingServiceHolder;
import gcsp.api.persistence.Canonical;
import gcsp.api.recommendation.CandidatesSelection;
import gcsp.api.remote.RemoteOperationProviders;
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

/** Generates a canonical remote claim, then accepts it through real JWT/JWKS and application HTTP at one fixture instant. */
@QuarkusTest
@TestProfile(GeneratedClaimRemoteOfferProfile.class)
class GeneratedClaimRemoteOfferHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String EMPLOYEE = "employee-paula";
    private static final String ORDER = "00000000-0000-4000-8000-000000000001";
    private static final String COMMAND = "generated-claim-owner-accept-1";
    private static final List<String> QUOTE = List.of("orderUuid", "configurationId", "snapshot", "terms",
            "employeeFacts", "reasons", "tradeOffs", "versions");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    IdentityPort identity;

    @Inject
    RemoteBuddy buddy;

    @Inject
    EligibleCandidates candidates;

    @Inject
    Allocation allocation;

    @Inject
    AccountSelection accounts;

    @Inject
    OrderingServiceHolder ordering;

    @Inject
    BeanManager beans;

    @Inject
    AgroalDataSource dataSource;

    @Test
    void canonicalGeneratedClaimIsAcceptedByOwnerJwtThroughSelectedRemoteBuddy() throws Exception {
        assertEquals("oidc", identity.mode());
        assertEquals("remote", buddy.mode());
        assertEquals("repository", accounts.mode());
        assertEquals("synthetic", ordering.provider());
        assertTrue(allocation.available());
        assertNotNull(candidates);
        var candidatesBean = beans.resolve(beans.getBeans(EligibleCandidates.class));
        assertNotNull(candidatesBean);
        assertEquals(CandidatesSelection.class, candidatesBean.getBeanClass());
        var remoteBean = beans.resolve(beans.getBeans(RemoteBuddy.class));
        assertNotNull(remoteBean);
        assertEquals(RemoteOperationProviders.class, remoteBean.getBeanClass());
        var recordsBean = beans.resolve(beans.getBeans(OfferRecords.class));
        assertNotNull(recordsBean);
        assertEquals(PostgresOfferRecords.class, recordsBean.getBeanClass());
        assertNoGeneratedOutputs();

        // This retains the existing same-instant fixture; FUCQ-516 later-clock recovery remains unproved here.
        AllocationScope scope = new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, DecisionEnv.NOW, 1);
        AllocationResult.Completed done = assertInstanceOf(AllocationResult.Completed.class,
                allocation.service().allocate(scope, new Trigger("stock-released", "generated-claim-stock-1", List.of(), List.of())));
        assertEquals(1, count("SELECT count(*) FROM allocation_runs WHERE allocation_id = ? AND contender_count = 1",
                done.allocationId()));
        assertEquals(1, count("SELECT count(*) FROM allocation_contenders WHERE allocation_id = ? "
                + "AND employee_id = ? AND order_uuid = ?", done.allocationId(), EMPLOYEE, ORDER));
        JsonNode evaluation = json("SELECT evaluation::text FROM allocation_evaluations WHERE allocation_id = ? "
                + "AND employee_id = ?", done.allocationId(), EMPLOYEE);
        assertEquals(1, evaluation.path("decisions").size());
        JsonNode computed = evaluation.path("decisions").get(0);
        assertEquals(ORDER, computed.path("orderUuid").asText());
        assertEquals("eligible", computed.path("gateStatus").asText());
        assertEquals(100, computed.path("score").asInt());
        assertEquals(DecisionEnv.POLICY, computed.path("versions").path("policy").asText());

        String offerId = text("SELECT o.offer_id FROM buddy_offers o JOIN buddy_quotes q "
                + "ON q.environment_id = o.environment_id AND q.run_id = o.run_id AND q.quote_id = o.quote_id "
                + "JOIN allocation_runs a ON a.environment_id = q.environment_id AND a.run_id = q.run_id "
                + "AND a.allocation_id = q.allocation_id WHERE a.allocation_id = ? AND o.employee_id = ? AND o.order_uuid = ?",
                done.allocationId(), EMPLOYEE, ORDER);
        String holdId = text("SELECT hold_id FROM buddy_offers WHERE offer_id = ?", offerId);
        String quoteId = text("SELECT quote_id FROM buddy_offers WHERE offer_id = ?", offerId);
        String claimOperation = text("SELECT operation_id FROM buddy_offers WHERE offer_id = ?", offerId);
        assertEquals(1, count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND state = 'active' "
                + "AND operation_id = ? AND employee_id = ? AND order_uuid = ?", holdId, claimOperation, EMPLOYEE, ORDER));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_id = ? "
                + "AND operation_type = 'buddy-claim' AND state = 'acknowledged' AND outcome->>'state' = 'offered' "
                + "AND outcome->>'offerId' = ?", claimOperation, offerId));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'buddy-claim'"));
        assertEquals(1, count("SELECT count(*) FROM buddy_quotes"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        JsonNode claim = json("SELECT payload::text FROM buddy_operations WHERE operation_id = ? "
                + "AND operation_type = 'buddy-claim'", claimOperation);
        assertEquals(done.allocationId(), claim.path("allocationId").asText());
        assertEquals(quoteId, claim.path("quoteId").asText());
        assertEquals(holdId, claim.path("holdId").asText());
        assertEquals(offerId, claim.path("offerId").asText());
        assertEquals(EMPLOYEE, claim.path("employeeId").asText());
        assertEquals(ORDER, claim.path("orderUuid").asText());
        assertFalse(claim.has("quote"), "the existing remote protocol carries the generated quote reference");
        JsonNode pinned = json("SELECT quote::text FROM buddy_quotes WHERE quote_id = ?", quoteId);
        assertEquals(ORDER, pinned.path("orderUuid").asText());
        assertEquals("RzIxOlMx", pinned.path("configurationId").asText());
        assertEquals("exact-stock", pinned.path("snapshot").path("identityKind").asText());
        assertEquals(ORDER, pinned.path("snapshot").path("sourceKeys").path("stockId").asText());
        assertEquals(DecisionEnv.POLICY, pinned.path("versions").path("policy").asText());
        assertTrue(pinned.path("employeeFacts").path("driverEligible").path("value").asBoolean());
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));

        String owner = ownerToken();
        get(owner, API + "/context").statusCode(200).body("value.employeeId", equalTo(EMPLOYEE))
                .body("value.environmentId", equalTo(OffersPg.ENV)).body("value.runId", equalTo("run-1"));
        String termsDigest = get(owner, API + "/manual/order/terms").statusCode(200).body("status", equalTo("ok"))
                .extract().jsonPath().getString("value.termsDigest");
        assertNotNull(termsDigest);
        assertFalse(termsDigest.isBlank());
        String path = API + "/offers/" + offerId;
        JsonPath offered = get(owner, path).statusCode(200).body("value.offerId", equalTo(offerId))
                .body("value.state", equalTo("pending")).body("value.reason", equalTo("awaiting-decision"))
                .extract().jsonPath();
        String decisionOperation = post(owner, path + "/decision", accept(termsDigest,
                offered.getLong("value.offerVersion"), offered.getLong("value.holdVersion")))
                .statusCode(202).body("status", equalTo("pending")).body("code", equalTo("decision-pending"))
                .body("retryable", equalTo(false)).body("offerId", equalTo(offerId)).body("commandId", equalTo(COMMAND))
                .body("$", not(hasKey("value"))).extract().jsonPath().getString("operationId");
        assertNotNull(decisionOperation);
        assertFalse(decisionOperation.isBlank());
        get(owner, path).statusCode(200).body("value.state", equalTo("accepted"))
                .body("value.reason", equalTo("accepted")).body("value.holdState", equalTo("allocated"))
                .body("value.availableActions", hasSize(0));

        assertEquals(1, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND employee_id = ? "
                + "AND hold_id = ? AND command_id = ? AND decision = 'accept' AND versions->>'quoteId' = ? "
                + "AND versions->>'decisionOperationId' = ?", offerId, EMPLOYEE, holdId, COMMAND, quoteId, decisionOperation));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-selection'"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_id = ? "
                + "AND operation_type = 'offer-selection' AND state = 'acknowledged'", decisionOperation));
        JsonNode selectionIntent = json("SELECT payload::text FROM offer_decision_operations WHERE operation_id = ?",
                decisionOperation);
        assertEquals(claimOperation, selectionIntent.path("sourceClaimOperationId").asText());
        assertEquals(quoteId, selectionIntent.path("quoteId").asText());
        assertEquals(offerId, selectionIntent.path("offerId").asText());
        assertEquals(EMPLOYEE, selectionIntent.path("employeeId").asText());
        assertEquals(ORDER, selectionIntent.path("orderUuid").asText());
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders WHERE employee_id = ? AND order_uuid = ? "
                + "AND hold_id = ? AND source_type = 'buddy-offer' AND selection->'quote'->>'quoteId' = ?",
                EMPLOYEE, ORDER, holdId, quoteId));
        String selectionOperation = text("SELECT operation_id FROM selection_orders WHERE hold_id = ?", holdId);
        assertEquals(selectionOperation, text("SELECT outcome->>'selectionOperationId' FROM pending_operations "
                + "WHERE operation_id = ?", decisionOperation));
        JsonNode selection = json("SELECT selection::text FROM selection_orders WHERE operation_id = ?", selectionOperation);
        assertEquals("replacement", selection.path("draft").path("mode").asText());
        assertEquals(5400, selection.path("sourceVersions").path("returnOdometer").path("value").asInt());
        assertTrue(selection.path("declarations").path("return").asBoolean());
        assertEquals("1000001", selection.path("stock").path("orderNumber").asText());
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND state = 'allocated'", holdId));
        assertEquals(1, count("SELECT count(*) FROM stock_cars WHERE order_uuid = ? AND state = 'allocated'", ORDER));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted' AND event_id = ?",
                "offer-accepted:" + holdId));
        assertQuoteProjection(pinned, json("SELECT quote::text FROM buddy_quotes WHERE quote_id = ?", quoteId));
        assertQuoteProjection(pinned, selection.path("quote"));
    }

    private void assertNoGeneratedOutputs() throws SQLException {
        for (String table : List.of("allocation_runs", "allocation_contenders", "allocation_evaluations", "allocation_attempts",
                "buddy_quotes", "custody_holds", "pending_operations", "buddy_operations", "buddy_offers",
                "offer_decisions", "offer_decision_operations", "selection_orders")) {
            assertEquals(0, count("SELECT count(*) FROM " + table), table);
        }
    }

    private static void assertQuoteProjection(JsonNode expected, JsonNode actual) {
        for (String key : QUOTE) assertEquals(Canonical.json(expected.get(key)), Canonical.json(actual.get(key)), key);
    }

    private static ObjectNode accept(String termsDigest, long offerVersion, long holdVersion) {
        ObjectNode body = JSON.createObjectNode().put("commandId", COMMAND).put("decision", "accept")
                .put("expectedOfferVersion", offerVersion).put("expectedHoldVersion", holdVersion)
                .put("termsDigest", termsDigest).put("expectedReturnMileage", 5400);
        body.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        return body;
    }

    private String ownerToken() throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(OffersTestProfile.ISSUER);
        claims.setAudience(OffersTestProfile.AUDIENCE);
        claims.setSubject("sub-employee-a");
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

    private JsonNode json(String sql, Object... parameters) throws Exception {
        return JSON.readTree(text(sql, parameters));
    }

    private String text(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                String value = rs.getString(1);
                assertNotNull(value);
                return value;
            }
        }
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
