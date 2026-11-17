package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.remote.RemoteOperationServer;
import gcsp.api.remote.RemoteOperationServer.Execute;
import gcsp.api.remote.RemoteOperationServer.Reconcile;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * AC2 through the started app: documented dev composition, real JWTs, native PostgreSQL, provider remote, and the real
 * HttpClaimStock calling a controlled loopback stock endpoint. Only the wall clock is replaced.
 */
@QuarkusTest
@TestProfile(RemoteClaimProfile.Lifecycle.class)
class ManualClaimsRemoteComposedHttpTest extends RemoteClaimComposedSupport {

    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final String CAR = U + "1";

    private int baseEffects;

    @BeforeEach
    void seed() throws Exception {
        seedStockAndDrafts();
        baseEffects = remote.totalEffects();
    }

    private int effectsSince() {
        return remote.totalEffects() - baseEffects;
    }

    private static String claimOp(String commandId) {
        return ManualClaims.operationId(commandId, "manual-claim");
    }

    private static String releaseOp(String commandId) {
        return ManualClaims.operationId(commandId, "manual-release");
    }

    @Test
    void aConfirmedRemoteClaimIsActiveWithOneEffectOnePostAndTheRetainedOperationId() throws Exception {
        String cmd = cid("ok");
        String op = claimOp(cmd);
        Resp r = post("sub-paula", "claim", claimInput("sub-paula", CAR, cmd));
        assertEquals(200, r.status(), r.toString());
        assertEquals("ok", r.state());
        assertEquals("active", r.hold().get("state").asText());
        assertEquals("remote", r.hold().get("mode").asText());
        assertEquals("active", holdState(CAR));
        assertEquals("remote", text("SELECT mode FROM manual_claims WHERE order_uuid = ?", CAR));
        assertEquals("acknowledged", opState(op));
        assertEquals(op, text("SELECT operation_id FROM custody_holds WHERE order_uuid = ?", CAR));
        assertEquals(op, text("SELECT operation_id FROM manual_claim_operations"));
        assertEquals(RemoteOperationServer.PROVIDER_REFERENCE_PREFIX + op, text("SELECT provider_reference FROM pending_operations WHERE operation_id = ?", op));
        assertEquals(1, remote.effects(op));
        assertEquals(1, remote.posts(op));
        assertEquals(0, remote.gets(op));
        assertEquals(1, effectsSince());
        var seen = remote.requests().stream().filter(x -> op.equals(x.operationId())).toList();
        assertEquals(1, seen.size());
        assertEquals("POST", seen.get(0).method());
        assertEquals("manual-claim", seen.get(0).type());
        assertEquals(CAR, seen.get(0).orderUuid());
        assertEquals(null, seen.get(0).authorization(), "no stock token is configured, so none is sent");
    }

    @Test
    void aLostClaimAnswerIsPendingKeepsTheCarOccupiedAndASweepConvergesWithOneEffect() throws Exception {
        ObjectNode rival = claimInput("sub-jordan", CAR, "x");
        String cmd = cid("lost");
        String op = claimOp(cmd);
        ObjectNode in = claimInput("sub-paula", CAR, cmd);
        remote.onExecute(Execute.APPLY_THEN_DROP);
        Resp p = post("sub-paula", "claim", in);
        assertEquals(202, p.status(), p.toString());
        assertEquals("pending", p.state());
        assertEquals("operation-pending", p.code());
        assertEquals(op, p.body().get("operationId").asText());
        assertEquals("claim-pending", holdState(CAR));
        assertEquals("pending", opState(op));
        assertEquals(1, remote.effects(op));
        assertEquals(1, remote.posts(op));
        assertEquals(1, occupying(CAR));
        assertRivalRefused(rival, CAR);
        sweep.sweepNow();
        assertEquals("active", holdState(CAR));
        assertEquals("acknowledged", opState(op));
        assertEquals(1, remote.effects(op));
        assertEquals(1, remote.posts(op), "reconcile asked, it did not execute again");
        assertEquals(1, remote.gets(op));
        assertEquals(1, effectsSince());
        assertEquals(1, occupying(CAR));
        assertRivalRefused(rival, CAR);
        // The client's retry of the same command gets the stored answer and no new stock traffic.
        int requests = remote.requests().size();
        Resp again = post("sub-paula", "claim", in);
        assertEquals(200, again.status(), again.toString());
        assertEquals(true, again.body().path("replayed").asBoolean());
        assertEquals(p.body().get("operationId").asText(), op);
        assertEquals(requests, remote.requests().size());
        assertEquals("active", get("sub-paula", "claim").hold().get("state").asText());
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void aRetryOfThePendingCommandReconcilesItWithoutASecondEffect() throws Exception {
        String cmd = cid("retry");
        String op = claimOp(cmd);
        ObjectNode in = claimInput("sub-paula", CAR, cmd);
        remote.onExecute(Execute.APPLY_THEN_DROP);
        assertEquals(202, post("sub-paula", "claim", in).status());
        Resp again = post("sub-paula", "claim", in);
        assertEquals(200, again.status(), again.toString());
        assertEquals(true, again.body().path("replayed").asBoolean());
        assertEquals("active", holdState(CAR), remote.calls().toString());
        assertEquals("acknowledged", opState(op));
        assertEquals(1, remote.effects(op));
        assertEquals(1, remote.posts(op));
        assertEquals(1, remote.gets(op));
        assertEquals(1, effectsSince());
    }

    @Test
    void aLostClaimRequestIsFoundAbsentByLookupAndExecutedOnceMore() throws Exception {
        String cmd = cid("req-lost");
        String op = claimOp(cmd);
        remote.onExecute(Execute.DROP);
        Resp p = post("sub-paula", "claim", claimInput("sub-paula", CAR, cmd));
        assertEquals(202, p.status(), p.toString());
        assertEquals(0, remote.effects(op));
        assertEquals("claim-pending", holdState(CAR));
        sweep.sweepNow();
        assertEquals("active", holdState(CAR));
        assertEquals("acknowledged", opState(op));
        assertEquals(1, remote.effects(op));
        assertEquals(2, remote.posts(op));
        assertEquals(1, remote.gets(op));
        sweep.sweepNow();
        assertEquals(2, remote.posts(op));
        assertEquals(1, remote.gets(op));
        assertEquals(1, effectsSince());
    }

    @Test
    void aMismatchedAckAndFailingLookupsStayPendingAndOccupyingWithNoReExecute() throws Exception {
        ObjectNode rival = claimInput("sub-jordan", CAR, "x");
        String cmd = cid("mismatch");
        String op = claimOp(cmd);
        remote.onExecute(Execute.MISMATCH);
        remote.onReconcile(Reconcile.MISMATCH, Reconcile.FAIL_500);
        Resp p = post("sub-paula", "claim", claimInput("sub-paula", CAR, cmd));
        assertEquals(202, p.status(), p.toString());
        long version = stockVersion(CAR);
        for (int i = 0; i < 2; i++) {
            sweep.sweepNow();
            assertEquals("claim-pending", holdState(CAR), "sweep " + i);
            assertEquals("pending", opState(op));
            assertEquals(1, occupying(CAR));
            assertEquals(version, stockVersion(CAR), "no premature release bumped the car");
            assertEquals(1, remote.posts(op), "an unusable answer is not a not-found, so nothing executes again");
            assertEquals(0, remote.effects(op));
            assertRivalRefused(rival, CAR);
        }
        assertEquals(2, remote.gets(op));
        // Only an authoritative lookup (not-found) lets the same operation execute once and converge.
        sweep.sweepNow();
        assertEquals("active", holdState(CAR));
        assertEquals("acknowledged", opState(op));
        assertEquals(2, remote.posts(op));
        assertEquals(3, remote.gets(op));
        assertEquals(1, remote.effects(op));
        assertEquals(1, effectsSince());
    }

    @Test
    void aReleaseWithALostResponseKeepsTheCarHeldUntilASweepFreesItOnceThenAnotherCanClaim() throws Exception {
        ObjectNode rival = claimInput("sub-jordan", CAR, "x");
        Resp held = post("sub-paula", "claim", claimInput("sub-paula", CAR, cid("rel-c")));
        assertEquals(200, held.status(), held.toString());
        String relCmd = cid("rel");
        String relOp = releaseOp(relCmd);
        remote.onExecute(Execute.APPLY_THEN_DROP);
        Resp rel = post("sub-paula", "claim/release", releaseBody(held.hold(), "cancel", relCmd));
        assertEquals(202, rel.status(), rel.toString());
        assertEquals(relOp, rel.body().get("operationId").asText());
        assertEquals("release-pending", holdState(CAR));
        assertEquals("pending", opState(relOp));
        assertEquals(1, occupying(CAR));
        assertEquals(1, remote.effects(relOp));
        assertEquals(1, remote.posts(relOp));
        assertRivalRefused(rival, CAR);
        sweep.sweepNow();
        assertEquals("released", holdState(CAR));
        assertEquals("cancel", text("SELECT release_reason FROM manual_claims WHERE order_uuid = ?", CAR));
        assertEquals("acknowledged", opState(relOp));
        assertEquals(0, occupying(CAR));
        assertEquals(3, stockVersion(CAR), "claim and one release each bumped the car once");
        assertEquals(1, remote.effects(relOp));
        assertEquals(1, remote.posts(relOp));
        assertEquals(1, remote.gets(relOp));
        assertEquals(2, effectsSince());
        String rivalCmd = cid("rival-ok");
        Resp won = post("sub-jordan", "claim", claimInput("sub-jordan", CAR, rivalCmd));
        assertEquals(200, won.status(), won.toString());
        assertEquals(1, occupying(CAR));
        assertEquals(1, remote.effects(claimOp(rivalCmd)));
        assertEquals(3, effectsSince());
    }

    @Test
    void duplicateAcksChangeNothingAfterConvergence() throws Exception {
        String claimCmd = cid("dup-c");
        String relCmd = cid("dup-r");
        ObjectNode claimIn = claimInput("sub-paula", CAR, claimCmd);
        remote.onExecute(Execute.APPLY_THEN_DROP);
        assertEquals(202, post("sub-paula", "claim", claimIn).status());
        sweep.sweepNow();
        assertEquals("active", holdState(CAR));
        long holdVersion = count("SELECT version FROM custody_holds WHERE order_uuid = ?", CAR);
        ObjectNode relIn = releaseBody(get("sub-paula", "claim").hold(), "change", relCmd);
        assertEquals(holdVersion, relIn.get("expectedHoldVersion").asLong());
        remote.onExecute(Execute.APPLY_THEN_DROP);
        assertEquals(202, post("sub-paula", "claim/release", relIn).status());
        sweep.sweepNow();
        assertEquals("released", holdState(CAR));
        String settled = snapshot();
        int requests = remote.requests().size();
        for (int i = 0; i < 3; i++) sweep.sweepNow();
        Resp claimAgain = post("sub-paula", "claim", claimIn);
        Resp releaseAgain = post("sub-paula", "claim/release", relIn);
        assertEquals(200, claimAgain.status(), claimAgain.toString());
        assertEquals(200, releaseAgain.status(), releaseAgain.toString());
        assertTrue(claimAgain.body().path("replayed").asBoolean());
        assertTrue(releaseAgain.body().path("replayed").asBoolean());
        assertEquals(settled, snapshot(), "no hold, operation, car or run revision moved");
        assertEquals(requests, remote.requests().size(), "no further stock traffic of any kind");
        assertEquals(2, effectsSince());
        assertEquals(1, remote.effects(claimOp(claimCmd)));
        assertEquals(1, remote.effects(releaseOp(relCmd)));
    }

    @Test
    void aRemoteExpiryIsAReleaseIntentAndTheCarFreesOnlyWhenTheStockAuthorityConfirms() throws Exception {
        ObjectNode rival = claimInput("sub-jordan", CAR, "x");
        Resp held = post("sub-paula", "claim", claimInput("sub-paula", CAR, cid("exp-c")));
        assertEquals(200, held.status(), held.toString());
        long preview = held.body().at("/value/quote/timing/previewSeconds").asLong();
        clock.now = T0.plusSeconds(preview - 1);
        int requests = remote.requests().size();
        sweep.sweepNow();
        assertEquals("active", holdState(CAR), "not yet due");
        assertEquals(requests, remote.requests().size());
        clock.now = T0.plusSeconds(preview + 1);
        // The release answer is lost and the same tick's lookup fails: the authority has acted, we do not know it yet.
        remote.onExecute(Execute.APPLY_THEN_DROP);
        remote.onReconcile(Reconcile.FAIL_500);
        sweep.sweepNow();
        String relOp = text("SELECT operation_id FROM custody_holds WHERE order_uuid = ?", CAR);
        assertTrue(relOp.startsWith("manual-op:"), relOp);
        assertEquals("release-pending", holdState(CAR));
        assertEquals("pending", opState(relOp));
        assertEquals("manual-release", text("SELECT operation_type FROM manual_claim_operations WHERE operation_id = ?", relOp));
        assertEquals(1, occupying(CAR));
        assertEquals(2, stockVersion(CAR));
        assertEquals(1, remote.effects(relOp));
        assertEquals(1, remote.posts(relOp));
        assertEquals(1, remote.gets(relOp));
        assertRivalRefused(rival, CAR);
        sweep.sweepNow();
        assertEquals("expired", holdState(CAR));
        assertEquals("expiry", text("SELECT release_reason FROM manual_claims WHERE order_uuid = ?", CAR));
        assertEquals("acknowledged", opState(relOp));
        assertEquals(0, occupying(CAR));
        assertEquals(3, stockVersion(CAR));
        assertEquals(1, remote.effects(relOp));
        assertEquals(1, remote.posts(relOp));
        assertEquals(2, remote.gets(relOp));
        assertEquals(2, effectsSince());
        sweep.sweepNow();
        assertEquals(2, remote.gets(relOp), "a closed operation is not asked about again");
        Resp won = post("sub-jordan", "claim", claimInput("sub-jordan", CAR, cid("exp-rival")));
        assertEquals(200, won.status(), won.toString());
    }
}
