package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.BASE;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.count;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.matchesPattern;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Greg's order tracking, one explicit request and queueing, and the presenter's guarded Production step, over real roles. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.Synthetic.class)
class GregOrdersHttpTest {

    private static final String ORDERS = BASE + "/greg/orders";
    private static final String QUEUE = ORDERS + "/queue";
    private static final String STEP = BASE + "/presenter/production";
    private static final String POLICY = "test-policy-1";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private String greg;
    private String presenter;
    private String employee;

    @BeforeEach
    void setUp() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        presenter = ProductionHttpSupport.token(jwk, "sub-presenter", "presenter");
        employee = ProductionHttpSupport.token(jwk, "sub-employee", "employee");
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
    }

    private JsonPath read() {
        return JsonPath.from(as(greg).get(ORDERS).then().statusCode(200).extract().asString());
    }

    private String stock() {
        return read().getString("value.versions.stock");
    }

    private static String body(String commandId, String model, String derivative, Object quantity, String policy, String stock) {
        return "{\"commandId\":\"" + commandId + "\",\"model\":\"" + model + "\",\"derivative\":\"" + derivative
                + "\",\"quantity\":" + quantity + ",\"expectedPolicyVersion\":\"" + policy + "\",\"expectedStockVersion\":\""
                + stock + "\"}";
    }

    /** A fresh supported request (one 3 Series Saloon 320i line); returns its id. */
    private String request(int quantity) {
        JsonPath r = JsonPath.from(as(greg).body(body(command(), "3 Series Saloon", "320i", quantity, POLICY, stock()))
                .post(ORDERS).then().statusCode(200).extract().asString());
        assertEquals("requested", r.getString("value.requests[0].state"));
        return r.getString("value.requests[0].requestId");
    }

    private long versionOf(String requestId) {
        List<Map<String, Object>> rows = read().getList("value.requests");
        return ((Number) rows.stream().filter(m -> requestId.equals(m.get("requestId"))).findFirst().orElseThrow().get("version")).longValue();
    }

    @Test
    void theReadCarriesTheVersionsAndEachRequestsVersionToQuote() throws Exception {
        String id = request(2);
        JsonPath r = read();
        assertEquals("ok", r.getString("status"));
        assertEquals(POLICY, r.getString("value.versions.policy"));
        assertTrue(r.getString("value.versions.stock").matches("[0-9a-f]{64}"));
        assertEquals(r.getString("value.asOf"), r.getString("value.versions.clock"));
        assertTrue(versionOf(id) >= 2, "an acknowledged request has been through intent and settle");
        // The same value the Production status read carries.
        JsonPath status = JsonPath.from(as(greg).get(BASE + "/greg/production").then().statusCode(200).extract().asString());
        assertEquals(status.getList("value.requests.requestId"), r.getList("value.requests.requestId"));
        as(greg).get(ORDERS + "?x=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as(greg).body("{}").get(ORDERS).then().statusCode(400).body("code", equalTo("unsupported-body"));
        as(employee).get(ORDERS).then().statusCode(403);
        as(presenter).get(ORDERS).then().statusCode(403);
    }

    @Test
    void aSupportedRequestIsDurableSentOnceAndAReplayAddsNothing() throws Exception {
        String c = command();
        String stock = stock();
        String b = body(c, "i5 Touring", "eDrive40", 3, POLICY, stock);
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        JsonPath first = JsonPath.from(as(greg).body(b).post(ORDERS).then().statusCode(200).extract().asString());
        assertEquals("requested", first.getString("value.requests[0].state"));
        assertEquals(3, first.getInt("value.requests[0].quantity"));
        assertEquals("l1", first.getString("value.requests[0].lineId"));
        String id = first.getString("value.requests[0].requestId");
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_requests WHERE request_id = ? AND state = 'requested' "
                + "AND model = 'i5 Touring' AND derivative = 'eDrive40' AND quantity = 3", id));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_submissions WHERE plan_id LIKE 'manual:%' "
                + "AND command_id = ?", c));
        assertEquals(orders + 1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));

        as(greg).body(b).post(ORDERS).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.requests[0].requestId", equalTo(id));
        assertEquals(orders + 1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));

        as(greg).body(body(c, "i5 Touring", "eDrive40", 4, POLICY, stock)).post(ORDERS).then().statusCode(409)
                .body("code", equalTo("idempotency-input-changed"));
        assertEquals(orders + 1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));

        // The same command id is a different submission from a plan's, so a plan command never replays it.
        String plan = "{\"commandId\":\"" + c + "\",\"planId\":\"plan-x\",\"versions\":{\"a\":\"1\"}}";
        as(greg).body(plan).post(BASE + "/greg/production/requests").then().statusCode(409);
    }

    @Test
    void aStalePolicyOrStockVersionIsRefusedAndNothingIsWritten() throws Exception {
        String stock = stock();
        long subs = count(dataSource.get(), "SELECT count(*) FROM production_submissions");
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        as(greg).body(body(command(), "3 Series Saloon", "320i", 1, "old-policy", stock)).post(ORDERS).then().statusCode(409)
                .body("code", equalTo("stale-version")).body("resource", equalTo("policy"))
                .body("expectedVersion", equalTo("old-policy")).body("currentVersion", equalTo(POLICY));

        var run = persistence.guard().currentRun();
        String car = "order-" + UUID.randomUUID();
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement("INSERT INTO stock_cars "
                + "(environment_id, run_id, order_uuid, configuration_id, state) VALUES (?, ?, ?, 'cfg-orders-http', 'available')")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            ps.setString(3, car);
            ps.executeUpdate();
            try {
                String current = stock();
                assertNotEquals(stock, current);
                as(greg).body(body(command(), "3 Series Saloon", "320i", 1, POLICY, stock)).post(ORDERS).then().statusCode(409)
                        .body("code", equalTo("stale-version")).body("resource", equalTo("stock"))
                        .body("expectedVersion", equalTo(stock)).body("currentVersion", equalTo(current));
            } finally {
                try (PreparedStatement del = c.prepareStatement("DELETE FROM stock_cars WHERE order_uuid = ?")) {
                    del.setString(1, car);
                    del.executeUpdate();
                }
            }
        }
        assertEquals(stock, stock(), "the version is a pure function of the stock rows");
        assertEquals(subs, count(dataSource.get(), "SELECT count(*) FROM production_submissions"));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
    }

    @Test
    void anUnknownChoiceEndsRefusedAndBadBodiesAndRolesAreRefused() {
        String stock = stock();
        as(greg).body(body(command(), "Delorean", "DMC-12", 1, POLICY, stock)).post(ORDERS).then().statusCode(200)
                .body("value.requests[0].state", equalTo("refused")).body("value.requests[0].code", equalTo("unknown-production-choice"));
        String c = command();
        as(greg).body(body(c, "3 Series Saloon", "320i", 0, POLICY, stock)).post(ORDERS).then().statusCode(400)
                .body("code", equalTo("invalid-production-command")).body("reasons.field", hasItem("quantity"));
        as(greg).body(body(c, "3 Series Saloon", "320i", 1001, POLICY, stock)).post(ORDERS).then().statusCode(400);
        as(greg).body(body(c, "3 Series Saloon", "320i", "\"2\"", POLICY, stock)).post(ORDERS).then().statusCode(400);
        as(greg).body(body(c, "3 Series Saloon", "320i", 1, POLICY, stock).replace("}", ",\"extra\":1}")).post(ORDERS).then()
                .statusCode(400).body("reasons.field", hasItem("extra"));
        as(greg).body(body(c, "3 Series Saloon", "320i", 1, POLICY, stock)).post(ORDERS + "?x=1").then().statusCode(400);
        as(employee).body(body(c, "3 Series Saloon", "320i", 1, POLICY, stock)).post(ORDERS).then().statusCode(403);
        as(presenter).body(body(c, "3 Series Saloon", "320i", 1, POLICY, stock)).post(ORDERS).then().statusCode(403);
        // An optional plan reference is kept with the request; a malformed one is refused.
        as(greg).body(body(command(), "3 Series Saloon", "320i", 1, POLICY, stock).replace("}",
                ",\"plan\":{\"planId\":\"plan-ref\",\"versions\":{\"policy\":\"p\"}}}")).post(ORDERS).then().statusCode(200);
        as(greg).body(body(command(), "3 Series Saloon", "320i", 1, POLICY, stock).replace("}", ",\"plan\":{\"planId\":\"\"}}"))
                .post(ORDERS).then().statusCode(400).body("reasons.field", hasItem("plan"));
    }

    @Test
    void thePresenterStepConfirmsOnceReplaysAndRefusesAStaleVersion() throws Exception {
        String id = request(3);
        long version = versionOf(id);
        String c = command();
        String confirm = "{\"commandId\":\"" + c + "\",\"requestId\":\"" + id + "\",\"expectedVersion\":" + version
                + ",\"action\":\"confirm\",\"quantity\":2}";
        // Wrong version first: nothing is scripted.
        as(presenter).body(confirm.replace("\"expectedVersion\":" + version, "\"expectedVersion\":" + (version + 5))).post(STEP).then()
                .statusCode(409).body("code", equalTo("stale-version")).body("resource", equalTo("request"))
                .body("expectedVersion", equalTo(Long.toString(version + 5))).body("currentVersion", equalTo(Long.toString(version)));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", id));

        as(presenter).body(confirm).post(STEP).then().statusCode(200).body("value.scripted.action", equalTo("confirm"))
                .body("value.requests[0].outcome", equalTo("applied"));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", id));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_confirmations WHERE request_id = ?", id));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                + "AND payload->>'requestId' = ?", id));
        JsonPath after = read();
        Map<String, Object> row = after.<Map<String, Object>>getList("value.requests").stream()
                .filter(m -> id.equals(m.get("requestId"))).findFirst().orElseThrow();
        assertEquals("partly-confirmed", row.get("state"));
        assertEquals(2, row.get("confirmedQuantity"));
        assertTrue(((Number) row.get("version")).longValue() > version);

        // The same command again, with the old version it was sent with, replays: no second answer, no extra confirmation.
        as(presenter).body(confirm).post(STEP).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.scripted.action", equalTo("confirm"));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", id));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_confirmations WHERE request_id = ?", id));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                + "AND payload->>'requestId' = ?", id));

        // The same command with a changed quantity is refused.
        as(presenter).body(confirm.replace("\"quantity\":2", "\"quantity\":1")).post(STEP).then().statusCode(409)
                .body("code", equalTo("idempotency-input-changed"));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", id));

        // A scripted refusal that the synthetic provider rejects writes nothing and leaves the version alone.
        long now = versionOf(id);
        as(presenter).body("{\"commandId\":\"" + command() + "\",\"requestId\":\"" + id + "\",\"expectedVersion\":" + now
                + ",\"action\":\"confirm\",\"quantity\":5}").post(STEP).then().statusCode(409).body("code", equalTo("quantity-exceeds-request"));
        assertEquals(now, versionOf(id));
        as(presenter).body("{\"commandId\":\"" + command() + "\",\"requestId\":\"request-missing\",\"expectedVersion\":1,"
                + "\"action\":\"confirm\",\"quantity\":1}").post(STEP).then().statusCode(404).body("code", equalTo("request-not-found"));

        // Roles and shapes.
        as(greg).body(confirm).post(STEP).then().statusCode(403);
        as(employee).body(confirm).post(STEP).then().statusCode(403);
        as(presenter).body(confirm).post(STEP + "?x=1").then().statusCode(400);
        as(presenter).body(confirm.replace("\"action\":\"confirm\"", "\"action\":\"explode\"")).post(STEP).then().statusCode(400);
        as(presenter).body(confirm.replace("\"expectedVersion\":" + version + ",", "")).post(STEP).then().statusCode(400);
        as(presenter).body(confirm.replace("}", ",\"extra\":1}")).post(STEP).then().statusCode(400);
    }

    @Test
    void queueingReturnsTheSupplyIdsOnceAndNeverSubmitsOrAsksProduction() throws Exception {
        String id = request(2);
        String confirm = "{\"commandId\":\"" + command() + "\",\"requestId\":\"" + id + "\",\"expectedVersion\":" + versionOf(id)
                + ",\"action\":\"confirm\",\"quantity\":2}";
        as(presenter).body(confirm).post(STEP).then().statusCode(200);
        String supply = JsonPath.from(as(greg).get(BASE + "/greg/production").asString()).<Map<String, Object>>getList("value.requests")
                .stream().filter(m -> id.equals(m.get("requestId"))).findFirst().map(m -> (String) ((Map<?, ?>) ((List<?>) m.get("supplies")).get(0)).get("supplyId"))
                .orElseThrow();
        // Already queued by the step: nothing to queue again.
        String q = "{\"commandId\":\"" + command() + "\",\"requestId\":\"" + id + "\"}";
        as(greg).body(q).post(QUEUE).then().statusCode(200).body("value.requestId", equalTo(id)).body("value.queued.size()", equalTo(0));

        // A confirmation supply never took (its queued mark is lost) is queued by this route, the same way as before.
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(
                "UPDATE production_confirmations SET queued_at = NULL, eligible_from = NULL WHERE supply_id = ?")) {
            ps.setString(1, supply);
            assertEquals(1, ps.executeUpdate());
        }
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        as(greg).body(q).post(QUEUE).then().statusCode(200).body("value.queued[0].supplyId", equalTo(supply))
                .body("value.queued[0].eligibleFrom", matchesPattern("20\\d\\d-.*Z"));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM production_confirmations WHERE supply_id = ? AND queued_at IS NOT NULL", supply));
        as(greg).body(q).post(QUEUE).then().statusCode(200).body("value.queued.size()", equalTo(0));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));

        as(greg).body("{\"commandId\":\"" + command() + "\",\"requestId\":\"request-missing\"}").post(QUEUE).then().statusCode(404)
                .body("code", equalTo("request-not-found"));
        as(greg).body("{\"requestId\":\"" + id + "\"}").post(QUEUE).then().statusCode(400);
        as(greg).body(q).post(QUEUE + "?x=1").then().statusCode(400);
        as(presenter).body(q).post(QUEUE).then().statusCode(403);
        as(employee).body(q).post(QUEUE).then().statusCode(403);
    }
}
