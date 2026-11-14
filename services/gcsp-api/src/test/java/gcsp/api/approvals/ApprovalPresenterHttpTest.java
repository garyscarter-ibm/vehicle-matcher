package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalHttpSupport.PROGRESS;
import static gcsp.api.approvals.ApprovalHttpSupport.RECONCILE;
import static gcsp.api.approvals.ApprovalHttpSupport.TICKS;
import static gcsp.api.approvals.ApprovalHttpSupport.as;
import static gcsp.api.approvals.ApprovalHttpSupport.tickBody;
import static gcsp.api.approvals.ApprovalHttpSupport.uuid;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.approvals.ApprovalHttpSupport.Clock;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The presenter over HTTP with the synthetic ordering scenario: ticks drive the lifecycle and every read is truthful. */
@QuarkusTest
@TestProfile(ApprovalHttpProfiles.Presenter.class)
class ApprovalPresenterHttpTest {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ApprovalHttpPorts.Orders orders;

    @Inject
    ApprovalStartup startup;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    private Clock clock() throws Exception {
        return ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
    }

    private Clock tick() throws Exception {
        Clock c = clock();
        as().body(tickBody("http-" + c.version() + "-" + System.nanoTime(), c)).post(TICKS).then().statusCode(200);
        return c;
    }

    @Test
    void ticksProgressAnOrderThroughEveryStageWithDistinctReferencesAndReplayChangesNothing() throws Exception {
        String order = uuid();
        orders.ready(order, "paula");
        Clock c = clock();
        String firstId = "http-first-" + System.nanoTime();
        String body = tickBody(firstId, c);
        as().body(body).post(TICKS).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.handlerId", equalTo("lifecycle-approvals")).body("value.replayed", nullValue());
        JsonPath view = as().get(PROGRESS + "?orderUuid=" + order).then().statusCode(200)
                .body("status", equalTo("ok")).body("value.currentStage", equalTo("HR approval"))
                .body("value.provider.synthetic", equalTo(true)).body("value.owner", equalTo("HR"))
                .extract().jsonPath();
        int revision = view.getInt("value.lifecycleRevision");

        as().body(body).post(TICKS).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.replayed", equalTo(true));
        assertEquals(revision, as().get(PROGRESS + "?orderUuid=" + order).jsonPath().getInt("value.lifecycleRevision"));

        String outcome = "in-progress";
        for (int i = 0; i < 15 && "in-progress".equals(outcome); i++) {
            tick();
            outcome = as().get(PROGRESS + "?orderUuid=" + order).jsonPath().getString("value.outcome");
        }
        JsonPath done = as().get(PROGRESS + "?orderUuid=" + order).then().statusCode(200).extract().jsonPath();
        assertEquals("sent-to-ordering", done.getString("value.outcome"));
        Set<String> references = new HashSet<>(done.getList("value.stages.providerReference", String.class));
        assertEquals(4, references.size(), "each stage has its own reference");
        assertTrue(done.getList("value.stages.state", String.class).stream().allMatch("approved"::equals));
        assertEquals("ordering", done.getString("value.owner"));
    }

    @Test
    void aChangedOrStaleTickIs409AndAMalformedOneIs400WithReasons() throws Exception {
        Clock c = clock();
        String id = "http-conflict-" + System.nanoTime();
        as().body(tickBody(id, c)).post(TICKS).then().statusCode(200);
        as().body(tickBody(id, c.next())).post(TICKS).then().statusCode(409).body("status", equalTo("conflict"))
                .body("code", equalTo("tick-input-changed"));
        as().body(tickBody("http-ahead-" + System.nanoTime(), c.next())).post(TICKS).then().statusCode(200);
        as().body(tickBody("http-stale-" + System.nanoTime(), c)).post(TICKS).then().statusCode(409)
                .body("code", equalTo("approval-clock-changed"));

        as().body("{\"tickId\":\"t\",\"now\":\"nope\",\"clockVersion\":0,\"extra\":1}").post(TICKS).then()
                .statusCode(400).body("code", equalTo("invalid-tick"))
                .body("reasons.field", hasItem("commandId")).body("reasons.field", hasItem("now"))
                .body("reasons.field", hasItem("clockVersion")).body("reasons.field", hasItem("extra"));
        as().body("not json").post(TICKS).then().statusCode(400).body("reasons.field", hasItem("body"));
        as().body("{\"commandId\":\"\",\"limit\":0,\"x\":1}").post(RECONCILE).then().statusCode(400)
                .body("code", equalTo("invalid-reconcile")).body("reasons.field", hasItem("commandId"))
                .body("reasons.field", hasItem("limit")).body("reasons.field", hasItem("x"));
        as().body("{\"commandId\":\"c\"}").post(TICKS + "?now=1").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
    }

    @Test
    void presenterReadsEveryOrderAndTheSyntheticProviderIsLabelled() throws Exception {
        String order = uuid();
        orders.ready(order, "paula");
        tick();
        as().get(PROGRESS + "/all?limit=100").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.orders.orderUuid", hasItem(order))
                .body("value.orders.find { it.orderUuid == '" + order + "' }.provider.synthetic", equalTo(true))
                .body("value.orders.find { it.orderUuid == '" + order + "' }.employeeId", equalTo("paula"));
        as().get(PROGRESS + "/all?limit=0").then().statusCode(400).body("code", equalTo("invalid-query"));
        as().get(PROGRESS + "/all?limit=101").then().statusCode(400).body("code", equalTo("invalid-query"));
        as().get(PROGRESS + "/all?limit=1&limit=2").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as().get(PROGRESS + "/all?employeeId=paula").then().statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    void readRefusalsAreTruthful() {
        as().get(PROGRESS).then().statusCode(400).body("status", equalTo("invalid"))
                .body("code", equalTo("invalid-order")).body("reasons", hasSize(1));
        as().get(PROGRESS + "?orderUuid=" + uuid()).then().statusCode(404).body("status", equalTo("not-found"));
        as().get(PROGRESS + "?orderUuid=a&orderUuid=b").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as().get(PROGRESS + "?orderUuid=a&runId=run-1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        String pending = uuid();
        orders.put(pending, new OrderSourcePort.NotReady("paula", "selection-pending", "The selection is still being sent on."));
        as().get(PROGRESS + "?orderUuid=" + pending).then().statusCode(503).body("status", equalTo("unavailable"))
                .body("code", equalTo("selection-pending")).body("state", equalTo("not-ready"))
                .body("retryable", equalTo(true));
        given().get(PROGRESS + "?orderUuid=x").then().statusCode(401).body("code", equalTo("bearer-missing"));
        given().post(TICKS).then().statusCode(401);
    }

    @Test
    void reconcileDeliversACountWithoutCountingTicksOrStartingOrders() throws Exception {
        String order = uuid();
        orders.ready(order, "paula");
        as().body("{\"commandId\":\"rec-1\"}").post(RECONCILE).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.examined", not(equalTo(null)));
        as().get(PROGRESS + "?orderUuid=" + order).then().statusCode(200).body("value.lifecycleRevision", equalTo(0));
        assertTrue(startup.summary().startsWith("reconciled:"), startup.summary());
        assertTrue(startup.reconcileOnce() >= 0);
        as().get(PROGRESS + "?orderUuid=" + order).then().statusCode(200).body("value.lifecycleRevision", equalTo(0));
    }
}
