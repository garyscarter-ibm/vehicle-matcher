package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalHttpSupport.PROGRESS;
import static gcsp.api.approvals.ApprovalHttpSupport.RECONCILE;
import static gcsp.api.approvals.ApprovalHttpSupport.TICKS;
import static gcsp.api.approvals.ApprovalHttpSupport.as;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** Without a database every approvals endpoint says so, and startup reconcile is skipped. */
@QuarkusTest
@TestProfile(ApprovalHttpProfiles.NoDatabase.class)
class ApprovalNoDatabaseHttpTest {

    @Inject
    ApprovalStartup startup;

    @Inject
    Persistence persistence;

    @Test
    void everyEndpointIs503PersistenceNotConfigured() {
        String now = "2026-11-13T09:00:00Z";
        as().body("{\"commandId\":\"c\",\"tickId\":\"t\",\"now\":\"" + now + "\",\"clockVersion\":1}").post(TICKS)
                .then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        as().body("{\"commandId\":\"c\"}").post(RECONCILE).then().statusCode(503)
                .body("code", equalTo("persistence-not-configured"));
        as().get(PROGRESS + "?orderUuid=x").then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        as().get(PROGRESS + "/all").then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        assertEquals(0, startup.reconcileOnce());
        assertEquals("skipped", startup.summary());
    }
}
