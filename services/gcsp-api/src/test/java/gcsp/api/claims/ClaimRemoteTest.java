package gcsp.api.claims;

import static gcsp.api.claims.ScriptedClaimStock.Step.APPLY_THEN_THROW;
import static gcsp.api.claims.ScriptedClaimStock.Step.MISMATCH;
import static gcsp.api.claims.ScriptedClaimStock.Step.NOT_FOUND;
import static gcsp.api.claims.ScriptedClaimStock.Step.REJECT;
import static gcsp.api.claims.ScriptedClaimStock.Step.THROW_BEFORE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunReset;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Remote mode: pending custody, one remote effect per operation, and convergence after loss, restart and reset. */
class ClaimRemoteTest {

    ClaimFixture f;
    ScriptedClaimStock stock;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        f.employee("e1");
        f.employee("e2");
        f.car("car-1");
        f.car("car-2");
        stock = new ScriptedClaimStock();
        f.claims = f.newClaims(stock);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    private String holdState() throws Exception {
        return f.text("SELECT state FROM custody_holds WHERE hold_type = 'cart' ORDER BY created_at DESC LIMIT 1");
    }

    private String opState() throws Exception {
        return f.text("SELECT state FROM pending_operations ORDER BY created_at DESC LIMIT 1");
    }

    private JsonNode claimed(String employee, String car) {
        return ClaimFixture.value(f.claims.claim(f.scope(employee), f.claimInput(car))).get("hold");
    }

    private JsonNode read(String employee) {
        return ClaimFixture.value(f.claims.readClaim(f.scope(employee))).get("hold");
    }

    private ClaimResult release(JsonNode hold, String reason) {
        return f.claims.release(f.scope("e1"), ClaimFixture.releaseInput(ClaimFixture.commandId(),
                hold.get("holdId").asText(), hold.get("version").asLong(), reason));
    }

    // ---- claim ----

    @Test
    void aConfirmedRemoteClaimIsActiveWithOneRemoteEffect() throws Exception {
        JsonNode h = claimed("e1", "car-1");
        assertEquals("active", h.get("state").asText());
        assertEquals("remote", h.get("mode").asText());
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals("acknowledged", opState());
        assertEquals(1, stock.ledger.totalEffects());
        assertEquals(1, f.count("SELECT count(*) FROM manual_claim_operations"));
        assertEquals("remote", f.text("SELECT mode FROM manual_claims"));
    }

    @Test
    void aLostClaimResponseIsPendingHoldsTheCarAndAReplayConvergesWithOneEffect() throws Exception {
        stock.onExecute(APPLY_THEN_THROW);
        ObjectNode input = f.claimInput("cmd-r2", "car-1", 1);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class, f.claims.claim(f.scope("e1"), input));
        assertEquals(ManualClaims.operationId("cmd-r2", "manual-claim"), p.operationId());
        assertEquals("claim-pending", holdState());
        stock.onReconcile(THROW_BEFORE);
        JsonNode view = ClaimFixture.value(f.claims.readClaim(f.scope("e1")));
        assertEquals("pending", view.get("view").get("state").asText());
        assertEquals(p.operationId(), view.get("pendingOperation").get("operationId").asText());
        assertEquals("claim-pending", holdState());
        // The pending hold occupies the car: another employee is refused, not served.
        ClaimResult other = f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 2));
        assertEquals("car-held", assertInstanceOf(ClaimResult.Conflict.class, other).code());
        // The retry of the same command replays; its own reconcile finishes the claim.
        ClaimResult.Ok again = assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("e1"), input.deepCopy()));
        assertTrue(again.replayed());
        assertEquals("active", holdState());
        assertEquals("acknowledged", opState());
        assertEquals(1, stock.ledger.effects(p.operationId()));
        assertEquals(1, stock.ledger.calls(p.operationId()));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void aLostClaimRequestIsFoundAbsentByReconcileAndExecutedOnce() throws Exception {
        stock.onExecute(THROW_BEFORE);
        ObjectNode input = f.claimInput("cmd-r3", "car-1", 1);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class, f.claims.claim(f.scope("e1"), input));
        assertEquals(0, stock.ledger.totalEffects());
        assertEquals("claim-pending", holdState());
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("active", holdState());
        assertEquals(1, stock.ledger.effects(p.operationId()));
        assertEquals(2, stock.ledger.calls(p.operationId()));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(1, stock.ledger.totalEffects());
    }

    @Test
    void aMismatchedAckAndAThrownReconcileKeepThePendingClaimAndItsCustody() throws Exception {
        stock.onExecute(MISMATCH);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        long revision = f.revision();
        stock.onReconcile(THROW_BEFORE, MISMATCH, NOT_FOUND);
        stock.onExecute(MISMATCH);
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("claim-pending", holdState());
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals("pending", opState());
        assertEquals(0, stock.ledger.totalEffects());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(p.operationId(), f.text("SELECT operation_id FROM custody_holds"));
        assertTrue(f.revision() >= revision);
    }

    @Test
    void aRejectedClaimFailsAndTheCarCanBeClaimedByAnotherEmployee() throws Exception {
        stock.onExecute(REJECT);
        ClaimResult first = f.claims.claim(f.scope("e1"), f.claimInput("car-1"));
        assertEquals("claim-failed", ClaimFixture.value(first).get("hold").get("state").asText());
        assertEquals("claim-failed", holdState());
        assertEquals("refused", opState());
        assertEquals(0, f.holdsOn("car-1"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(3, f.carVersion("car-1"));
        ClaimResult second = f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 3));
        assertEquals("active", ClaimFixture.value(second).get("hold").get("state").asText());
    }

    // ---- release and expiry ----

    @Test
    void aReleaseWithALostResponseKeepsTheCarHeldUntilReconcileFreesItOnce() throws Exception {
        JsonNode h = claimed("e1", "car-1");
        stock.onExecute(APPLY_THEN_THROW);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class, release(h, "cancel"));
        assertEquals("release-pending", holdState());
        assertEquals(1, f.holdsOn("car-1"));
        stock.onReconcile(THROW_BEFORE);
        assertEquals("release-required", assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-2"))).code());
        assertEquals("car-held", assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 2))).code());
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("released", holdState());
        assertEquals(0, f.holdsOn("car-1"));
        assertEquals("cancel", f.text("SELECT release_reason FROM manual_claims"));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(2, stock.ledger.totalEffects());
        assertEquals(1, stock.ledger.effects(p.operationId()));
        assertEquals(3, f.carVersion("car-1"));
    }

    @Test
    void aRejectedReleaseReturnsTheHoldToActive() throws Exception {
        JsonNode h = claimed("e1", "car-1");
        stock.onExecute(REJECT);
        ClaimResult r = release(h, "change");
        assertEquals("quoted", ClaimFixture.value(r).get("state").asText());
        assertEquals("active", holdState());
        assertEquals("refused", opState());
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals(0, f.count("SELECT count(*) FROM manual_claims WHERE release_reason IS NOT NULL"));
        JsonNode again = read("e1");
        assertEquals("active", again.get("state").asText());
        assertEquals(h.get("version").asLong() + 2, again.get("version").asLong());
    }

    @Test
    void aRemoteExpiryWithALostResponseConvergesThroughReconcileOpen() throws Exception {
        claimed("e1", "car-1");
        f.clock.now = ClaimFixture.T0.plusSeconds(120);
        stock.onExecute(APPLY_THEN_THROW);
        assertEquals(0, f.claims.expireDue(f.system(), 10));
        assertEquals("release-pending", holdState());
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals(0, f.claims.expireDue(f.system(), 10));
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("expired", holdState());
        assertEquals("expiry", f.text("SELECT release_reason FROM manual_claims"));
        assertEquals(0, f.holdsOn("car-1"));
        assertEquals(2, stock.ledger.totalEffects());
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
    }

    // ---- restart, duplicate and late acknowledgements ----

    @Test
    void aRestartedServiceFindsTheOpenOperationAndConvergesWithoutADuplicateEffect() throws Exception {
        stock.onExecute(APPLY_THEN_THROW);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        ScriptedClaimStock restarted = new ScriptedClaimStock(stock.ledger);
        ManualClaims fresh = f.newClaims(restarted);
        assertEquals(1, fresh.reconcileOpen(f.system(), 10));
        assertEquals("active", holdState());
        assertEquals(1, stock.ledger.effects(p.operationId()));
        assertEquals(1, stock.ledger.calls(p.operationId()));
        assertEquals(0, fresh.reconcileOpen(f.system(), 10));
    }

    @Test
    void aDuplicateAckChangesNothingAndASupersededOperationIsRefused() throws Exception {
        stock.onExecute(THROW_BEFORE);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        // The hold now answers to a different operation: a late ack for this one must not touch it.
        f.update("UPDATE custody_holds SET operation_id = 'manual-op:other'");
        assertFalse(f.claims.drive(f.scope("e1").context(), p.operationId(), false));
        assertEquals("claim-pending", holdState());
        assertEquals("pending", opState());
        f.update("UPDATE custody_holds SET operation_id = ?", p.operationId());
        assertTrue(f.claims.drive(f.scope("e1").context(), p.operationId(), false));
        long revision = f.revision();
        String before = f.text("SELECT version || state FROM custody_holds");
        assertFalse(f.claims.drive(f.scope("e1").context(), p.operationId(), false));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(revision, f.revision());
        assertEquals(before, f.text("SELECT version || state FROM custody_holds"));
        assertEquals(1, stock.ledger.totalEffects());
    }

    @Test
    void anAckAfterTheRunWasResetIsRefusedAndChangesNoRow() throws Exception {
        stock.onExecute(APPLY_THEN_THROW);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        String database = f.text("SELECT current_database()");
        Outcome reset = new RunReset(f.pool(), database, ClaimFixture.ENV)
                .reset(ClaimFixture.ENV, "actor-1", "reset-1", ClaimFixture.RUN, "run-2");
        assertInstanceOf(Outcome.Committed.class, reset);
        String before = f.text("SELECT string_agg(hold_id || state || version, ',') FROM custody_holds") + "|"
                + f.text("SELECT string_agg(operation_id || state || version, ',') FROM pending_operations");
        assertFalse(f.claims.drive(f.scope("e1").context(), p.operationId(), false));
        assertEquals(0, f.claims.reconcileOpen(f.system(), 10));
        assertEquals(before, f.text("SELECT string_agg(hold_id || state || version, ',') FROM custody_holds") + "|"
                + f.text("SELECT string_agg(operation_id || state || version, ',') FROM pending_operations"));
        assertEquals("claim-pending", holdState());
        assertEquals(0, f.count("SELECT count(*) FROM runs r WHERE r.run_id = 'run-2' AND r.revision > 0"));
    }

    // ---- convertSelection ----

    private JsonNode reviewed() {
        JsonNode h = claimed("e1", "car-1");
        return ClaimFixture.value(f.claims.beginReview(f.scope("e1"),
                ClaimFixture.actionInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong()))).get("hold");
    }

    private SelectionCommit insert(String id, AtomicInteger calls) {
        return tx -> {
            calls.incrementAndGet();
            tx.write("INSERT INTO claims_test_orders (id) VALUES (?)", id);
            return gcsp.api.persistence.WorkResult.ok(ClaimFixture.JSON.createObjectNode());
        };
    }

    private ClaimResult convert(JsonNode hold, String orderId, AtomicInteger calls) {
        return f.claims.convertSelection(f.scope("e1"), ClaimFixture.actionInput(ClaimFixture.commandId(),
                hold.get("holdId").asText(), hold.get("version").asLong()), insert(orderId, calls));
    }

    @Test
    void aRemoteConvertSelectionCommitsTheCallbackWithTheIntentAndAllocatesWhenConfirmed() throws Exception {
        JsonNode h = reviewed();
        stock.onExecute(APPLY_THEN_THROW);
        AtomicInteger calls = new AtomicInteger();
        assertInstanceOf(ClaimResult.Pending.class, convert(h, "order-1", calls));
        assertEquals("selection-pending", holdState());
        assertEquals(1, f.count("SELECT count(*) FROM claims_test_orders"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("allocated", holdState());
        assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(0, f.holdsOn("car-1"));
        assertEquals(1, calls.get());
        assertEquals(1, f.count("SELECT count(*) FROM claims_test_orders"));
    }

    @Test
    void aRejectedRemoteAllocationReturnsTheHoldToActiveAndTheCallbackRowRemainsAsInNode() throws Exception {
        JsonNode h = reviewed();
        stock.onExecute(REJECT);
        AtomicInteger calls = new AtomicInteger();
        convert(h, "order-1", calls);
        assertEquals("active", holdState());
        assertEquals("refused", opState());
        assertEquals(1, f.count("SELECT count(*) FROM claims_test_orders"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(1, f.holdsOn("car-1"));
    }
}
