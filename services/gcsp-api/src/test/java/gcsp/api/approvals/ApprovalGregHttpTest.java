package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalHttpSupport.PROGRESS;
import static gcsp.api.approvals.ApprovalHttpSupport.RECONCILE;
import static gcsp.api.approvals.ApprovalHttpSupport.TICKS;
import static gcsp.api.approvals.ApprovalHttpSupport.as;
import static gcsp.api.approvals.ApprovalHttpSupport.tickBody;
import static gcsp.api.approvals.ApprovalHttpSupport.uuid;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import gcsp.api.approvals.ApprovalHttpSupport.Clock;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Greg reads every order but cannot command; with provider none a tick can never approve an order. */
@QuarkusTest
@TestProfile(ApprovalHttpProfiles.GregNone.class)
class ApprovalGregHttpTest {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ApprovalHttpPorts.Orders orders;

    @Inject
    ApprovalServiceHolder holder;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @Test
    void gregReadsEveryOrderButCannotTickOrReconcile() throws Exception {
        String a = uuid();
        String b = uuid();
        orders.ready(a, "paula");
        orders.ready(b, "alex");
        as().get(PROGRESS + "/all?limit=100").then().statusCode(200).body("value.orders.orderUuid", hasItems(a, b));
        as().get(PROGRESS + "?orderUuid=" + a).then().statusCode(200).body("value.employeeId", equalTo("paula"));
        Clock c = ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
        as().body(tickBody("greg-denied", c)).post(TICKS).then().statusCode(403).body("code", equalTo("role-required"));
        as().body("{\"commandId\":\"c\"}").post(RECONCILE).then().statusCode(403).body("code", equalTo("role-required"));
    }

    @Test
    void withProviderNoneTicksLeaveTheOrderPendingAndNeverApprovedByTimeAlone() throws Exception {
        String order = uuid();
        orders.ready(order, "paula");
        var run = persistence.guard().currentRun();
        RunContext scope = new RunContext(run.environmentId(), run.runId(), "presenter");
        ApprovalService service = holder.service().orElseThrow();
        for (int i = 0; i < 8; i++) {
            Clock c = ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
            assertInstanceOf(ApprovalResult.Ok.class,
                    service.tick(scope, new ApprovalService.TickInput("none-" + System.nanoTime(), c.now(), c.version())));
        }
        JsonPath v = as().get(PROGRESS + "?orderUuid=" + order).then().statusCode(200).extract().jsonPath();
        assertEquals("in-progress", v.getString("value.outcome"));
        assertEquals("pending", v.getString("value.stages[1].state"));
        assertEquals("none", v.getString("value.provider.mode"));
        assertEquals(false, v.getBoolean("value.provider.synthetic"));
        assertEquals("provider-uncertain", v.getString("value.blocked.code"));
        int revision = v.getInt("value.lifecycleRevision");
        Clock c = ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
        service.tick(scope, new ApprovalService.TickInput("none-last-" + System.nanoTime(), c.now(), c.version()));
        assertEquals(revision, as().get(PROGRESS + "?orderUuid=" + order).jsonPath().getInt("value.lifecycleRevision"));
    }
}
