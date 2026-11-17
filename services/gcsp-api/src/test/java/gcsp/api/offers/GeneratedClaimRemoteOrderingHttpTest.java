package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.allocation.Trigger;
import gcsp.api.identity.IdentityPort;
import gcsp.api.ordering.HttpOrderingProvider;
import gcsp.api.ordering.OrderingProviderBindings;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingServiceHolder;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.ValidatableResponse;
import jakarta.enterprise.inject.spi.BeanManager;
import jakarta.inject.Inject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
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
 * Generated canonical claim, owner RS256 JWT acceptance, then the owner's GET /manual/order through the production route,
 * account slots and selected remote Holder. Same fixture instant as the retained test; no clock advance.
 */
@QuarkusTest
@TestProfile(GeneratedClaimRemoteOrderingProfile.class)
class GeneratedClaimRemoteOrderingHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String EMPLOYEE = "employee-paula";
    private static final String ORDER = "00000000-0000-4000-8000-000000000001";
    private static final String COMMAND = "generated-claim-remote-ordering-accept-1";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "gcsp.ordering.reconcile-url")
    String orderingReconcileUrl;

    @Inject
    IdentityPort identity;

    @Inject
    RemoteBuddy buddy;

    @Inject
    Allocation allocation;

    @Inject
    OrderingServiceHolder ordering;

    @Inject
    OrderingProviderBindings bindings;

    @Inject
    BeanManager beans;

    @Inject
    AgroalDataSource dataSource;

    @Test
    void generatedClaimAcceptedByOwnerJwtIsAcknowledgedOnceThroughSelectedRemoteOrdering() throws Exception {
        assertEquals("oidc", identity.mode());
        assertEquals("remote", buddy.mode());
        assertEquals("remote", ordering.provider());
        assertEquals("remote", bindings.mode());
        assertEquals(OrderingProviderBindings.class,
                beans.resolve(beans.getBeans(OrderingProviderBindings.class)).getBeanClass());
        assertEquals(OrderingServiceHolder.class, beans.resolve(beans.getBeans(OrderingServiceHolder.class)).getBeanClass());
        assertInstanceOf(HttpOrderingProvider.class, bindings.provider(dataSource));
        OrderingService service = ordering.service().orElseThrow();
        assertSame(service, ordering.service().orElseThrow(), "the holder caches one service");
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        JsonNode before = stats();
        assertEquals(0, before.path("executes").asInt(), "startup made no ordering request");
        assertEquals(0, before.path("reconciles").asInt());

        // Retained same-instant fixture; FUCQ-516 later-clock recovery is not addressed here.
        AllocationScope scope = new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, DecisionEnv.NOW, 1);
        AllocationResult.Completed done = assertInstanceOf(AllocationResult.Completed.class,
                allocation.service().allocate(scope, new Trigger("stock-released", "generated-claim-stock-1", List.of(), List.of())));
        String offerId = text("SELECT o.offer_id FROM buddy_offers o JOIN buddy_quotes q "
                + "ON q.environment_id = o.environment_id AND q.run_id = o.run_id AND q.quote_id = o.quote_id "
                + "WHERE q.allocation_id = ? AND o.employee_id = ? AND o.order_uuid = ?", done.allocationId(), EMPLOYEE, ORDER);
        String holdId = text("SELECT hold_id FROM buddy_offers WHERE offer_id = ?", offerId);
        String quoteId = text("SELECT quote_id FROM buddy_offers WHERE offer_id = ?", offerId);
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'buddy-claim' "
                + "AND state = 'acknowledged' AND outcome->>'offerId' = ?", offerId));

        String owner = ownerToken();
        String termsDigest = get(owner, API + "/manual/order/terms").statusCode(200).body("status", equalTo("ok"))
                .extract().jsonPath().getString("value.termsDigest");
        String path = API + "/offers/" + offerId;
        JsonPath offered = get(owner, path).statusCode(200).body("value.state", equalTo("pending")).extract().jsonPath();
        String decisionOperation = post(owner, path + "/decision", accept(termsDigest,
                offered.getLong("value.offerVersion"), offered.getLong("value.holdVersion")))
                .statusCode(202).body("code", equalTo("decision-pending")).body("offerId", equalTo(offerId))
                .extract().jsonPath().getString("operationId");
        assertNotNull(decisionOperation);
        get(owner, path).statusCode(200).body("value.state", equalTo("accepted")).body("value.holdState", equalTo("allocated"));

        // The selection the application persisted from the owner's decision, not one this test wrote.
        String selection = text("SELECT operation_id FROM selection_orders WHERE hold_id = ?", holdId);
        assertEquals(selection, text("SELECT outcome->>'selectionOperationId' FROM pending_operations "
                + "WHERE operation_id = ?", decisionOperation));
        assertEquals(1, count("SELECT count(*) FROM selection_orders WHERE operation_id = ? AND employee_id = ? "
                + "AND order_uuid = ? AND source_type = 'buddy-offer' AND selection->'quote'->>'quoteId' = ?",
                selection, EMPLOYEE, ORDER, quoteId));
        JsonNode stored = json("SELECT selection::text FROM selection_orders WHERE operation_id = ?", selection);
        String slot = text("SELECT entitlement_slot_id FROM selection_orders WHERE operation_id = ?", selection);
        String policy = text("SELECT policy_version FROM selection_orders WHERE operation_id = ?", selection);
        String digest = text("SELECT input_digest FROM pending_operations WHERE operation_id = ?", selection);
        OrderingScope orderingScope = new OrderingScope(OffersPg.ENV, "run-1", EMPLOYEE, slot, policy);
        String reference = GeneratedClaimRemoteOrderingResource.REFERENCE_PREFIX + selection;

        // The owner's order/status read: OrderingSlots/AccountService find the slot; a pending handoff is reconciled here.
        int executesBeforeRead = stats().path("executes").asInt();
        assertTrue(executesBeforeRead <= 1, "the decision drives at most one execute");
        JsonPath order = get(owner, API + "/manual/order").statusCode(200).body("status", equalTo("ok"))
                .extract().jsonPath();
        assertEquals("acknowledged", order.getString("value.status"));
        assertEquals(reference, order.getString("value.providerReference"));
        assertEquals(holdId, order.getString("value.selection.holdId"));
        assertEquals(quoteId, order.getString("value.selection.quoteId"));
        assertEquals("awaiting-approval", order.getString("value.view.state"));
        assertEquals(1, stats().path("executes").asInt(), "the owner's read leaves exactly one remote execute");
        get(owner, API + "/manual/order").statusCode(200).body("value.status", equalTo("acknowledged"))
                .body("value.providerReference", equalTo(reference));
        assertEquals(1, stats().path("executes").asInt(), "a repeated owner read never executes again");

        // The existing reconciliation boundary (SelectionOrderTickHandler's) now answers from the settled record.
        OrderingResult reconciled = service.reconcile(orderingScope, selection);
        OrderingResult.Ok ok = assertInstanceOf(OrderingResult.Ok.class, reconciled);
        assertEquals("acknowledged", ok.value().path("status").asText());
        assertEquals(reference, ok.value().path("providerReference").asText());

        JsonNode after = stats();
        assertEquals(1, after.path("executes").asInt(), "exactly one remote execute");
        JsonNode execute = null;
        boolean reconcileFirst = false;
        for (JsonNode seen : after.path("observed")) {
            if (execute == null && "reconcile".equals(seen.path("path").asText())
                    && selection.equals(seen.path("operationId").asText())) reconcileFirst = true;
            if ("execute".equals(seen.path("path").asText())) execute = seen;
        }
        assertTrue(reconcileFirst, "a same-id GET lookup precedes the execute");
        assertNotNull(execute);
        assertEquals(selection, execute.path("idempotencyKey").asText());
        JsonNode body = execute.path("body");
        assertEquals(selection, body.path("operationId").asText());
        assertEquals(selection, body.path("idempotencyKey").asText());
        assertEquals(digest, body.path("inputDigest").asText());
        assertEquals(ORDER, body.path("orderUuid").asText());
        assertEquals(stored.path("stock").path("orderNumber").asText(), body.path("orderNumber").asText());
        assertEquals("1000001", body.path("orderNumber").asText());
        assertEquals(stored.path("stock").path("configurationId").asText(), body.path("configurationId").asText());
        assertEquals(stored.path("terms").path("approvalStages").path(0).asText(), body.path("firstApprovalStage").asText());
        assertEquals("run-1", body.path("runId").asText());
        assertEquals(EMPLOYEE, body.path("employeeId").asText());
        assertEquals(slot, body.path("entitlementSlotId").asText());

        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_id = ? AND operation_type = "
                + "'selection-order' AND idempotency_key = ? AND state = 'acknowledged' AND provider_reference = ? "
                + "AND outcome->>'status' = 'confirmed' AND (outcome->>'fictional')::boolean", selection, selection, reference));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged' "
                + "AND event_id = ? AND payload->>'providerReference' = ? AND payload->>'orderUuid' = ?",
                selection + ":outcome", reference, ORDER));
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND state = 'allocated'", holdId));
        assertEquals(1, count("SELECT count(*) FROM stock_cars WHERE order_uuid = ? AND state = 'allocated'", ORDER));

        OrderingResult.Ok read = assertInstanceOf(OrderingResult.Ok.class, service.read(orderingScope));
        assertEquals("acknowledged", read.value().path("status").asText());
        assertEquals(holdId, read.value().path("selection").path("holdId").asText());
        assertEquals(quoteId, read.value().path("selection").path("quoteId").asText());
        assertEquals("awaiting-approval", read.value().path("view").path("state").asText());

        // A replayed reconcile of the settled selection answers from the record and never executes again.
        assertInstanceOf(OrderingResult.Ok.class, service.reconcile(orderingScope, selection));
        assertEquals(1, stats().path("executes").asInt());
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
    }

    private JsonNode stats() throws Exception {
        URI uri = URI.create(orderingReconcileUrl.replace("/ordering/reconcile", "/ordering/stats"));
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            HttpResponse<String> r = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(2)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(200, r.statusCode());
            return JSON.readTree(r.body());
        }
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
