package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalHttpSupport.PROGRESS;
import static gcsp.api.approvals.ApprovalHttpSupport.RECONCILE;
import static gcsp.api.approvals.ApprovalHttpSupport.TICKS;
import static gcsp.api.approvals.ApprovalHttpSupport.as;
import static gcsp.api.approvals.ApprovalHttpSupport.tickBody;
import static gcsp.api.approvals.ApprovalHttpSupport.uuid;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

import gcsp.api.approvals.ApprovalHttpSupport.Clock;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** An employee reads only their own orders and cannot command anything. */
@QuarkusTest
@TestProfile(ApprovalHttpProfiles.Employee.class)
class ApprovalEmployeeHttpTest {

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

    private void tickAsSystem() throws Exception {
        Clock c = ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
        var run = persistence.guard().currentRun();
        holder.service().orElseThrow().tick(new RunContext(run.environmentId(), run.runId(), "presenter"),
                new ApprovalService.TickInput("emp-tick-" + System.nanoTime(), c.now(), c.version()));
    }

    @Test
    void anEmployeeReadsOwnOrdersWithOwnerAndNextStepButNeverAForeignOne() throws Exception {
        String mine = uuid();
        String theirs = uuid();
        orders.ready(mine, ApprovalHttpProfiles.OWNER);
        orders.ready(theirs, "someone-else");
        tickAsSystem();
        as().get(PROGRESS + "?orderUuid=" + mine).then().statusCode(200).body("value.owner", notNullValue())
                .body("value.nextStep", notNullValue()).body("value.currentStage", equalTo("HR approval"))
                .body("value.employeeId", equalTo(ApprovalHttpProfiles.OWNER));
        as().get(PROGRESS + "?orderUuid=" + theirs).then().statusCode(403).body("status", equalTo("forbidden"))
                .body("code", equalTo("not-resource-owner")).body("retryable", equalTo(false));
        as().get(PROGRESS + "/all?limit=100").then().statusCode(200).body("value.orders.orderUuid", hasItem(mine))
                .body("value.orders.orderUuid", not(hasItem(theirs)))
                .body("value.orders.employeeId", not(hasItem("someone-else")));
    }

    @Test
    void anEmployeeCannotCommandAnything() throws Exception {
        Clock c = ApprovalHttpSupport.nextClock(dataSource.get(), persistence);
        as().body(tickBody("emp-denied", c)).post(TICKS).then().statusCode(403).body("code", equalTo("role-required"));
        as().body("{\"commandId\":\"c\"}").post(RECONCILE).then().statusCode(403).body("code", equalTo("role-required"));
        as().body("{\"orderUuid\":\"x\",\"decision\":\"approved\"}").post(PROGRESS).then().statusCode(405);
    }
}
