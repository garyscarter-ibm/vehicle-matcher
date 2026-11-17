package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/**
 * Restart: the test resource plays the previous process (before Quarkus starts) and leaves a remote claim whose answer
 * was lost. The started app, with fresh beans and the real HttpClaimStock, must converge it without a second effect.
 */
@QuarkusTest
@TestProfile(RemoteClaimProfile.Restart.class)
class ManualClaimsRemoteRestartHttpTest extends RemoteClaimComposedSupport {

    private static final String CAR = RemoteClaimStockResource.PRIOR_CAR;

    @Test
    void aClaimLeftPendingByAPreviousProcessConvergesInTheStartedAppWithoutADuplicateEffect() throws Exception {
        String op = ManualClaims.operationId(RemoteClaimStockResource.PRIOR_COMMAND, "manual-claim");
        // State the previous process left behind: durable pending claim, one remote effect, one POST, no lookups yet.
        assertEquals("claim-pending", holdState(CAR));
        assertEquals("pending", opState(op));
        assertEquals(op, text("SELECT operation_id FROM custody_holds WHERE order_uuid = ?", CAR));
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, remote.effects(op));
        assertEquals(1, remote.posts(op));
        assertEquals(0, remote.gets(op));
        assertEquals(1, occupying(CAR));
        long version = stockVersion(CAR);
        sweep.sweepNow();
        assertEquals("active", holdState(CAR));
        assertEquals("acknowledged", opState(op));
        assertEquals(RemoteClaimStockResource.PRIOR_EMPLOYEE, text("SELECT employee_id FROM custody_holds WHERE order_uuid = ?", CAR));
        assertEquals(1, remote.effects(op), "the restarted process asked and did not execute again");
        assertEquals(1, remote.totalEffects());
        assertEquals(1, remote.posts(op));
        assertEquals(1, remote.gets(op));
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, occupying(CAR));
        assertEquals(version, stockVersion(CAR), "a confirmed claim does not bump the car again");
        String settled = snapshot();
        int requests = remote.requests().size();
        sweep.sweepNow();
        sweep.sweepNow();
        assertEquals(settled, snapshot());
        assertEquals(requests, remote.requests().size());
        assertTrue(remote.requests().stream().allMatch(r -> r.runId().equals("run-1")));
    }
}
