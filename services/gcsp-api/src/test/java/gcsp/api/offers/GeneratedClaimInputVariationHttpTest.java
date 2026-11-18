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
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.EligibleCandidates.Car;
import gcsp.api.allocation.EligibleCandidates.Decision;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
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
import java.util.ArrayList;
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
 * Changed employee and stock source rows alter the selected candidates' computed eligibility; restored rows then drive the
 * retained generated claim, owner JWT decision and owner GET /manual/order through selected remote ordering.
 */
@QuarkusTest
@TestProfile(GeneratedClaimInputVariationProfile.class)
class GeneratedClaimInputVariationHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String EMPLOYEE = "employee-paula";
    private static final String ORDER = "00000000-0000-4000-8000-000000000001";
    private static final String COMMAND = "generated-claim-input-variation-accept-1";
    private static final String RUN = "run-1";
    private static final String CHANGED_MODEL = "G21 Touring|M340i";

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
    EligibleCandidates candidates;

    @Inject
    AccountRecordsPort records;

    @Inject
    AgroalDataSource dataSource;

    @Test
    void changedSourceFactsAlterComputedEligibilityAndRestoredSourcesDriveTheOwnersOrder() throws Exception {
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

        // Selected candidates over the repository provider; the caller's record is always the canonical stored one.
        JsonNode canonicalRecord = json("SELECT record::text FROM employee_account_records WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE);
        JsonNode canonicalCar = json("SELECT attributes::text FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", OffersPg.ENV, RUN, ORDER);
        Evaluated canonical = evaluate(canonicalRecord);
        Decision base = only(canonical);
        assertEquals("eligible", base.gateStatus());
        assertTrue(base.quote() != null && base.quote().isObject());

        // Employee source: only the employee driver's eligible.value differs, provenance unchanged.
        ObjectNode denied = canonicalRecord.deepCopy();
        ObjectNode eligible = employeeDriverEligible(denied);
        eligible.put("value", false);
        ObjectNode back = denied.deepCopy();
        employeeDriverEligible(back).set("value", employeeDriverEligible((ObjectNode) canonicalRecord.deepCopy()).get("value"));
        assertEquals(canonicalRecord, back, "the records differ only at the employee driver's eligible.value");
        writeRecord(denied);
        SourceResult selectedDrivers = records.readDrivers(scope());
        assertTrue(selectedDrivers.isOk());
        assertEquals(false, employeeDriverEligible((ObjectNode) selectedDrivers.value().deepCopy()).path("value").asBoolean(true),
                "the selected repository provider reads the changed fact");
        Evaluated driverChanged = evaluate(canonicalRecord);
        Decision driverDenied = only(driverChanged);
        assertEquals(ORDER, driverDenied.orderUuid());
        assertEquals("ineligible", driverDenied.gateStatus());
        assertTrue(codes(driverDenied.blockers()).contains("driver-ineligible"), driverDenied.blockers().toString());
        assertEquals(eligible, driverDenied.quote().path("employeeFacts").path("driverEligible"));
        assertEquals(canonical.versions().get("policy"), driverChanged.versions().get("policy"));
        assertEquals(canonical.versions().get("stock"), driverChanged.versions().get("stock"));
        writeRecord(canonicalRecord);
        assertEquals(canonicalRecord, json("SELECT record::text FROM employee_account_records WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE));
        assertEquals(canonical, evaluate(canonicalRecord), "restored employee source restores the computed candidates");

        // Stock source: only the car's eligibilityModelKey value differs; the account source is canonical again.
        ObjectNode changedCar = canonicalCar.deepCopy();
        ObjectNode model = (ObjectNode) changedCar.path("facts").path("facts").get("eligibilityModelKey");
        JsonNode canonicalModel = model.get("value");
        model.put("value", CHANGED_MODEL);
        ObjectNode carBack = changedCar.deepCopy();
        ((ObjectNode) carBack.path("facts").path("facts").get("eligibilityModelKey")).set("value", canonicalModel);
        assertEquals(canonicalCar, carBack, "the cars differ only at one stock model-key fact value");
        writeCar(changedCar);
        Evaluated stockChanged = evaluate(canonicalRecord);
        Decision excluded = only(stockChanged);
        assertEquals(ORDER, excluded.orderUuid());
        assertEquals("ineligible", excluded.gateStatus());
        assertTrue(codes(excluded.blockers()).contains("policy-exclude"), excluded.blockers().toString());
        assertEquals(CHANGED_MODEL, excluded.quote().path("snapshot").path("facts").path("eligibilityModelKey")
                .path("value").asText());
        assertEquals(canonical.versions().get("facts"), stockChanged.versions().get("facts"));
        assertEquals(canonical.versions().get("policy"), stockChanged.versions().get("policy"));
        writeCar(canonicalCar);
        assertEquals(canonical, evaluate(canonicalRecord), "restored stock source restores the computed candidates");
        for (String table : List.of("allocation_runs", "buddy_quotes", "custody_holds", "buddy_offers", "selection_orders")) {
            assertEquals(0, count("SELECT count(*) FROM " + table), table + " has no output from the denied variants");
        }

        // Retained same-instant fixture; FUCQ-516 later-clock recovery is not addressed here.
        AllocationScope scope = new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, DecisionEnv.NOW, 1);
        AllocationResult.Completed done = assertInstanceOf(AllocationResult.Completed.class,
                allocation.service().allocate(scope, new Trigger("stock-released", "generated-claim-stock-1", List.of(), List.of())));
        String offerId = text("SELECT o.offer_id FROM buddy_offers o JOIN buddy_quotes q "
                + "ON q.environment_id = o.environment_id AND q.run_id = o.run_id AND q.quote_id = o.quote_id "
                + "WHERE q.allocation_id = ? AND o.employee_id = ? AND o.order_uuid = ?", done.allocationId(), EMPLOYEE, ORDER);
        String holdId = text("SELECT hold_id FROM buddy_offers WHERE offer_id = ?", offerId);
        String quoteId = text("SELECT quote_id FROM buddy_offers WHERE offer_id = ?", offerId);
        // The durable quote is the restored canonical computation, not either variant.
        JsonNode durable = json("SELECT quote::text FROM buddy_quotes WHERE quote_id = ?", quoteId);
        JsonNode computed = JSON.readTree(base.quote().toString()); // jsonb round trip may narrow number node types
        for (String key : List.of("orderUuid", "configurationId", "snapshot", "terms", "employeeFacts", "versions")) {
            assertEquals(computed.get(key), durable.get(key), key);
        }
        assertEquals(1, count("SELECT count(*) FROM buddy_quotes"));
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND order_uuid = ?", holdId, ORDER));
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

    private Evaluated evaluate(JsonNode callerRecord) throws Exception {
        // Assembled from the same source rows as allocation/Prepare.java (owner, brief head, released pool).
        JsonNode attributes = json("SELECT attributes::text FROM employees WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE);
        long employeeVersion = count("SELECT version FROM employees WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE);
        long briefVersion = count("SELECT brief_version FROM brief_heads WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE);
        JsonNode brief = json("SELECT content::text FROM briefs WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ? AND brief_version = ?", OffersPg.ENV, RUN, EMPLOYEE, briefVersion);
        List<Car> cars = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT order_uuid, "
                + "configuration_id, version, attributes::text FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND state = 'released' ORDER BY order_uuid")) {
            ps.setString(1, OffersPg.ENV);
            ps.setString(2, RUN);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    cars.add(new Car(rs.getString(1), rs.getString(2), rs.getLong(3), JSON.readTree(rs.getString(4))));
                }
            }
        }
        var result = candidates.evaluate(new EligibleCandidates.Request(OffersPg.ENV, RUN, DecisionEnv.POLICY,
                DecisionEnv.NOW, 1, new EligibleCandidates.Subject(EMPLOYEE, attributes.path("entitlementSlotId").asText(),
                        employeeVersion, attributes, callerRecord, briefVersion, brief), cars));
        return assertInstanceOf(Evaluated.class, result, String.valueOf(result));
    }

    private AccountScope scope() throws Exception {
        JsonNode a = json("SELECT attributes::text FROM employees WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", OffersPg.ENV, RUN, EMPLOYEE);
        return new AccountScope(OffersPg.ENV, RUN, EMPLOYEE, null, List.of("employee"), a.path("companyId").asText(),
                a.path("schemeId").asText(), a.path("gradeId").asText(), a.path("entitlementSlotId").asText(),
                DecisionEnv.POLICY);
    }

    private static Decision only(Evaluated evaluated) {
        assertEquals(1, evaluated.decisions().size());
        return evaluated.decisions().get(0);
    }

    private static ObjectNode employeeDriverEligible(ObjectNode record) {
        for (JsonNode driver : record.path("drivers")) {
            if ("employee".equals(driver.path("kind").asText()) && EMPLOYEE.equals(driver.path("employeeId").asText())) {
                return (ObjectNode) driver.get("eligible");
            }
        }
        throw new AssertionError("The canonical record has no employee driver");
    }

    private static List<String> codes(JsonNode blockers) {
        List<String> out = new ArrayList<>();
        for (JsonNode b : blockers) out.add(b.path("code").asText());
        return out;
    }

    private void writeRecord(JsonNode record) throws SQLException {
        assertEquals(1, update("UPDATE employee_account_records SET record = ?::jsonb WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", record.toString(), OffersPg.ENV, RUN, EMPLOYEE));
    }

    private void writeCar(JsonNode attributes) throws SQLException {
        assertEquals(1, update("UPDATE stock_cars SET attributes = ?::jsonb WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", attributes.toString(), OffersPg.ENV, RUN, ORDER));
    }

    private int update(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            return ps.executeUpdate();
        }
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
        body.put("runId", "run-1").put("expectedQuoteVersion", 1);
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
