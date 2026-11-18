package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.ACTIVITY;
import static gcsp.api.production.ProductionHttpSupport.RECONCILE;
import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.RESPONSES;
import static gcsp.api.production.ProductionHttpSupport.STATUS;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.count;
import static gcsp.api.production.ProductionHttpSupport.scriptBody;
import static gcsp.api.production.ProductionHttpSupport.submitBody;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Greg submits and tracks, the presenter scripts the synthetic scenario, and nobody else can do either, over real roles. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.Synthetic.class)
class ProductionHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ProductionHttpPorts.Plan plan;

    @Inject
    ProductionServiceHolder holder;

    @Inject
    ProductionStartup startup;

    private String greg;
    private String presenter;
    private String employee;

    @BeforeEach
    void setUp() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        plan.reset();
        greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        presenter = ProductionHttpSupport.token(jwk, "sub-presenter", "presenter");
        employee = ProductionHttpSupport.token(jwk, "sub-employee", "employee");
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
    }

    private JsonPath submit() {
        return JsonPath.from(as(greg).body(submitBody(command(), plan.planId(), "s1")).post(REQUESTS).then().statusCode(200)
                .extract().asString());
    }

    private static String requestOf(JsonPath submitted, String lineId) {
        List<Map<String, Object>> rows = submitted.getList("value.requests");
        return rows.stream().filter(r -> lineId.equals(r.get("lineId"))).map(r -> (String) r.get("requestId")).findFirst().orElseThrow();
    }

    @Test
    void gregSubmitsAndTracksAndThePresenterOnlyReads() {
        JsonPath r = submit();
        assertEquals("ok", r.getString("status"));
        assertEquals(2, r.getList("value.requests").size());
        assertEquals(List.of("requested", "requested"), r.getList("value.requests.state"));
        String l1 = requestOf(r, "l1");
        as(greg).get(STATUS).then().statusCode(200).body("value.requests.requestId", hasItem(l1))
                .body("value.provider.mode", equalTo("synthetic"));
        as(presenter).get(STATUS).then().statusCode(200).body("value.requests.requestId", hasItem(l1));
        as(presenter).get(ACTIVITY).then().statusCode(200).body("value.replan.status", equalTo("unchanged-since-submission"));
    }

    @Test
    void theOnlyRequestPathIsGregsAndEveryOtherRoleIsRefused() {
        String body = submitBody(command(), plan.planId(), "s1");
        as(presenter).body(body).post(REQUESTS).then().statusCode(403).body("code", equalTo("role-required"));
        as(employee).body(body).post(REQUESTS).then().statusCode(403);
        as(employee).get(STATUS).then().statusCode(403);
        as(employee).get(ACTIVITY).then().statusCode(403);
        as(employee).body(scriptBody("x", "refuse", null)).post(RESPONSES).then().statusCode(403);
        as(employee).body("{}").post(RECONCILE).then().statusCode(403);
        as(greg).body(scriptBody("x", "refuse", null)).post(RESPONSES).then().statusCode(403);
        as(greg).body("{}").post(RECONCILE).then().statusCode(403);
    }

    @Test
    void staleVersionsAreRefusedWithTheChangedInputsAndNothingIsSent() throws Exception {
        long before = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        as(greg).body(submitBody(command(), plan.planId(), "s0")).post(REQUESTS).then().statusCode(409).body("status", equalTo("conflict"))
                .body("code", equalTo("replan-needed")).body("changedInputs", equalTo(List.of("stock")))
                .body("current.versions.stock", equalTo("s1"));
        assertEquals(before, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
    }

    @Test
    void anUnknownFieldAWrongTypeOrAQueryParameterIsRefused() {
        String c = command();
        as(greg).body("{\"commandId\":\"" + c + "\",\"planId\":\"p\",\"versions\":{\"a\":\"1\"},\"quantity\":9}")
                .post(REQUESTS).then().statusCode(400).body("code", equalTo("invalid-production-command"))
                .body("reasons.field", hasItem("quantity"));
        as(greg).body("{\"commandId\":7,\"planId\":\"p\",\"versions\":{\"a\":1}}").post(REQUESTS).then().statusCode(400)
                .body("reasons.field", hasItem("commandId")).body("reasons.field", hasItem("versions.a"));
        as(greg).body("[]").post(REQUESTS).then().statusCode(400);
        as(greg).body(submitBody(c, plan.planId(), "s1")).post(REQUESTS + "?planId=x").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as(greg).get(STATUS + "?x=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as(presenter).get(ACTIVITY + "?x=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as(presenter).body("{}").post(RECONCILE + "?x=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as(presenter).body(scriptBody("r", "refuse", null)).post(RESPONSES + "?x=1").then().statusCode(400);
    }

    @Test
    void theSameCommandAgainIsAReplayWithoutADuplicateOperation() throws Exception {
        String c = command();
        as(greg).body(submitBody(c, plan.planId(), "s1")).post(REQUESTS).then().statusCode(200);
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        as(greg).body(submitBody(c, plan.planId(), "s1")).post(REQUESTS).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.requests", hasSize(2));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
    }

    @Test
    void aPartialConfirmationIsQueuedAndTriggersTheReplanSignal() throws Exception {
        JsonPath r = submit();
        String l1 = requestOf(r, "l1");
        as(presenter).body(scriptBody(l1, "confirm", 1)).post(RESPONSES).then().statusCode(200)
                .body("value.scripted.action", equalTo("confirm")).body("value.requests[0].outcome", equalTo("applied"));
        JsonPath status = JsonPath.from(as(greg).get(STATUS).then().statusCode(200).extract().asString());
        Map<String, Object> row = status.getList("value.requests", Map.class).stream()
                .filter(m -> l1.equals(m.get("requestId"))).findFirst().orElseThrow();
        assertEquals(1, row.get("confirmedQuantity"));
        assertEquals(1, row.get("queuedQuantity"));
        assertEquals(0, row.get("releasedQuantity"));
        assertEquals(1, row.get("outstandingQuantity"));
        as(greg).get(ACTIVITY).then().statusCode(200).body("value.replan.status", equalTo("replanned"))
                .body("value.requests.confirmedQuantity", hasItem(1));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                + "AND payload->>'requestId' = ? AND payload->>'state' = 'partly-confirmed'", l1));
    }

    @Test
    void aFreshRequestCanBeRefusedAndScriptRefusalsAreHonest() {
        String l1 = requestOf(submit(), "l1");
        as(presenter).body(scriptBody(l1, "confirm", 99)).post(RESPONSES).then().statusCode(409)
                .body("code", equalTo("quantity-exceeds-request"));
        as(presenter).body(scriptBody("request-missing", "confirm", 1)).post(RESPONSES).then().statusCode(404)
                .body("code", equalTo("request-not-found"));
        as(presenter).body("{\"requestId\":\"" + l1 + "\",\"action\":\"explode\"}").post(RESPONSES).then().statusCode(400);
        as(presenter).body("{\"requestId\":\"" + l1 + "\",\"action\":\"refuse\",\"reason\":\"No build slots.\"}")
                .post(RESPONSES).then().statusCode(200);
        JsonPath status = JsonPath.from(as(greg).get(STATUS).then().extract().asString());
        Map<String, Object> row = status.getList("value.requests", Map.class).stream()
                .filter(m -> l1.equals(m.get("requestId"))).findFirst().orElseThrow();
        assertEquals("refused", row.get("state"));
        assertEquals("No build slots.", row.get("reason"));
        as(presenter).body(scriptBody(l1, "confirm", 1)).post(RESPONSES).then().statusCode(409).body("code", equalTo("request-refused"));
    }

    @Test
    void thePresenterReconcileRouteNeverSubmitsAndValidatesItsLimit() throws Exception {
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        as(presenter).body("").post(RECONCILE).then().statusCode(200).body("value.reconciled", org.hamcrest.Matchers.greaterThanOrEqualTo(0));
        as(presenter).body("{\"limit\":5}").post(RECONCILE).then().statusCode(200);
        as(presenter).body("{\"limit\":0}").post(RECONCILE).then().statusCode(400).body("code", equalTo("invalid-limit"));
        as(presenter).body("{\"limit\":\"all\"}").post(RECONCILE).then().statusCode(400);
        as(presenter).body("{\"commandId\":\"x\"}").post(RECONCILE).then().statusCode(400);
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
    }

    @Test
    void startupReconcileSettlesAnAnswerScriptedWhileTheAppWasDownAndNeverOrders() throws Exception {
        String l1 = requestOf(submit(), "l1");
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        var run = persistence.guard().currentRun();
        var scope = new gcsp.api.persistence.RunContext(run.environmentId(), run.runId(), "presenter");
        var synthetic = (SyntheticProductionProvider) holder.provider();
        var now = holder.clock().now(scope).orElseThrow();
        assertTrue(synthetic.script(scope, l1, "confirm", 2, null, null, now).ok());
        assertTrue(startup.reconcileOnce() >= 1);
        assertTrue(startup.summary().startsWith("reconciled:"), startup.summary());
        JsonPath status = JsonPath.from(as(greg).get(STATUS).then().extract().asString());
        Map<String, Object> row = status.getList("value.requests", Map.class).stream()
                .filter(m -> l1.equals(m.get("requestId"))).findFirst().orElseThrow();
        assertEquals("confirmed", row.get("state"));
        assertEquals(2, row.get("queuedQuantity"));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
        assertNotNull(row.get("providerReference"));
    }

    @Test
    void aMessageIsPlainText() {
        String text = as(greg).get(STATUS).then().statusCode(200).extract().asString();
        assertTrue(!text.contains("—"), "no em dashes in user-facing text");
        as(presenter).body(scriptBody("request-missing", "confirm", 1)).post(RESPONSES).then().statusCode(404)
                .body("reason", containsString("No such Production request"));
    }
}
