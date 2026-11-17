package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.remote.RemoteOperationServer;
import gcsp.api.remote.RemoteOperationServer.Execute;
import gcsp.api.remote.RemoteOperationServer.Reconcile;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Component evidence: ManualClaims with the real HttpClaimStock over loopback HTTP and PostgreSQL.
 * Not browser sign-in, OIDC, email or the whole connected journey.
 */
class HttpClaimLifecyclePgTest {

    ClaimFixture f;
    RemoteOperationServer remote;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        f.employee("e1");
        f.employee("e2");
        f.car("car-1");
        f.car("car-2");
        remote = RemoteOperationServer.start();
        f.claims = f.newClaims(remote.claimStock());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (remote != null) remote.close();
        if (f != null) f.close();
    }

    private String holdState() throws Exception {
        return f.text("SELECT state FROM custody_holds WHERE hold_type = 'cart' ORDER BY created_at DESC LIMIT 1");
    }

    private String opState() throws Exception {
        return f.text("SELECT state FROM pending_operations ORDER BY created_at DESC LIMIT 1");
    }

    @Test
    void aConfirmedHttpClaimIsActiveWithOneEffectAndOnePost() throws Exception {
        String operationId = ManualClaims.operationId("cmd-http-1", "manual-claim");
        JsonNode h = ClaimFixture.value(f.claims.claim(f.scope("e1"), f.claimInput("cmd-http-1", "car-1", 1))).get("hold");
        assertEquals("active", h.get("state").asText());
        assertEquals("remote", h.get("mode").asText());
        assertEquals("active", holdState());
        assertEquals("remote", f.text("SELECT mode FROM manual_claims"));
        assertEquals("acknowledged", opState());
        assertEquals(operationId, f.text("SELECT operation_id FROM pending_operations"));
        assertEquals(1, remote.effects(operationId));
        assertEquals(1, remote.totalEffects());
        assertEquals(1, remote.posts(operationId));
        assertEquals(List.of("POST:manual-claim"), remote.calls());
        assertEquals("car-1", remote.requests().get(0).orderUuid());
    }

    @Test
    void aLostAnswerIsPendingHoldsTheCarAndReconcileFindsTheOneEffect() throws Exception {
        remote.onExecute(Execute.APPLY_THEN_DROP);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("cmd-http-2", "car-1", 1)));
        assertEquals(ManualClaims.operationId("cmd-http-2", "manual-claim"), p.operationId());
        assertEquals("claim-pending", holdState());
        assertEquals("pending", opState());
        assertEquals(1, remote.effects(p.operationId()));
        // The pending hold occupies the car: another employee is refused, not served.
        ClaimResult other = f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 2));
        assertEquals("car-held", assertInstanceOf(ClaimResult.Conflict.class, other).code());
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("active", holdState());
        assertEquals("acknowledged", opState());
        assertEquals(1, remote.effects(p.operationId()));
        assertEquals(1, remote.posts(p.operationId()));
        assertTrue(remote.gets(p.operationId()) >= 1);
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(1, remote.totalEffects());
    }

    @Test
    void aLostRequestIsFoundAbsentByLookupAndExecutedOnceMore() throws Exception {
        remote.onExecute(Execute.DROP);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("cmd-http-3", "car-1", 1)));
        assertEquals(0, remote.totalEffects());
        assertEquals("claim-pending", holdState());
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("active", holdState());
        assertEquals("acknowledged", opState());
        assertEquals(1, remote.effects(p.operationId()));
        assertEquals(2, remote.posts(p.operationId()));
        assertTrue(remote.gets(p.operationId()) >= 1);
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(1, remote.totalEffects());
    }

    @Test
    void aMismatchedAckAndFailedLookupsKeepThePendingClaimWithNoExecute() throws Exception {
        remote.onExecute(Execute.MISMATCH);
        remote.onReconcile(Reconcile.MISMATCH, Reconcile.FAIL_500);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("cmd-http-4", "car-1", 1)));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("claim-pending", holdState());
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals("pending", opState());
        assertEquals(0, remote.totalEffects());
        // A failed or mismatched lookup is not NotFound, so nothing executes again.
        assertEquals(1, remote.posts(p.operationId()));
        assertEquals(2, remote.gets(p.operationId()));
        assertEquals(p.operationId(), f.text("SELECT operation_id FROM custody_holds"));
    }

    @Test
    void aRejectedHttpClaimFailsAndTheCarCanBeClaimedByAnotherEmployee() throws Exception {
        remote.onExecute(Execute.REJECT);
        ClaimResult first = f.claims.claim(f.scope("e1"), f.claimInput("car-1"));
        assertEquals("claim-failed", ClaimFixture.value(first).get("hold").get("state").asText());
        assertEquals("claim-failed", holdState());
        assertEquals("refused", opState());
        assertEquals(0, f.holdsOn("car-1"));
        assertEquals(0, remote.totalEffects());
        ClaimResult second = f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 3));
        assertEquals("active", ClaimFixture.value(second).get("hold").get("state").asText());
        assertEquals(1, remote.totalEffects());
        assertEquals(List.of("POST:manual-claim", "POST:manual-claim"), remote.calls());
    }
}
