package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.sql.SQLException;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CurrentCarStoreTest {

    static final Instant RETURNED_AT = Instant.parse("2026-11-07T10:30:00Z");
    static final Instant COLLECTED_AT = Instant.parse("2026-11-07T09:30:00Z");
    static final String VIN = "WBA12345678901234";

    ReturnsFixture f;
    TransactionRunner runner;
    CurrentCarStore store;
    ReturnSource source;
    int seq;

    @BeforeEach
    void setUp() throws Exception {
        f = ReturnsFixture.create();
        runner = new TransactionRunner(f.pool());
        store = new CurrentCarStore(f.pool());
        source = InMemoryReturnSource.replacement("order-1", "emp-1");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    CurrentCarEvent returned() {
        return new CurrentCarEvent(CurrentCarEvent.RETURN_CONFIRMED, "order-1", "emp-1", RETURNED_AT, "SYN-RET-AAAAAAAAAAAA",
                "contract-1", null, ReturnJson.JSON.createObjectNode().put("label", "BMW Park Lane"), "slot-20261107T0900Z",
                "SYN-APT-111111111111");
    }

    CurrentCarEvent collected() {
        return new CurrentCarEvent(CurrentCarEvent.HANDOVER_COMPLETED, "order-1", "emp-1", COLLECTED_AT, "SYN-APT-222222222222",
                null, VIN, null, "slot-20261107T0900Z", "SYN-APT-222222222222");
    }

    /** Runs apply in its own command; a refusal rolls the whole command back, as a caller would. */
    Applied apply(CurrentCarEvent e, ReturnSource s) {
        AtomicReference<CurrentCarResult> got = new AtomicReference<>();
        Outcome o = runner.execute(f.ctx(), new Command("current-car", "cmd-" + (++seq), ReturnJson.JSON.createObjectNode().put("n", seq)), tx -> {
            CurrentCarResult r = store.apply(tx, e, s);
            got.set(r);
            return r instanceof CurrentCarResult.Refused x ? WorkResult.refuse(x.code(), x.message())
                    : WorkResult.ok(ReturnJson.JSON.createObjectNode().put("applied", ((CurrentCarResult.Applied) r).applied()));
        });
        return new Applied(o, got.get());
    }

    record Applied(Outcome outcome, CurrentCarResult result) {
        CurrentCarResult.Applied applied() {
            return assertInstanceOf(CurrentCarResult.Applied.class, result);
        }

        String refusedCode() {
            return assertInstanceOf(CurrentCarResult.Refused.class, result).code();
        }
    }

    long rows(String table) throws SQLException {
        return f.count("SELECT count(*) FROM " + table);
    }

    @Test
    void theBaselineReadIsOldHeldNewOnOrderAndWritesNothing() throws Exception {
        CurrentCarView v = store.read(f.ctx(), "order-1", source);
        assertEquals("held", v.oldCar().status());
        assertEquals("contract-1", v.oldCar().contractId());
        assertEquals("slot-ent-1", v.oldCar().slotId());
        assertEquals("on-order", v.newCar().status());
        assertEquals("cfg-1", v.newCar().configurationId());
        assertTrue(v.changes().isEmpty());
        ObjectNode json = v.toJson();
        assertEquals("lifecycle.current-car.v1", json.get("contractVersion").asText());
        assertEquals("contract", json.get("currentCar").get("kind").asText());
        assertEquals("contract-1", json.get("currentCar").get("contractId").asText());
        assertTrue(json.get("fictional").asBoolean());
        assertEquals(0, rows("current_car_relationships"));
        assertEquals(0, rows("current_car_events"));
        assertEquals(0, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }

    @Test
    void aNewOrderBaselineHasNoOldCarAndNoCurrentCar() throws Exception {
        CurrentCarView v = store.read(f.ctx(), "order-2", InMemoryReturnSource.newOrder("order-2", "emp-1"));
        assertNull(v.oldCar());
        assertNull(v.currentCar());
        assertTrue(v.toJson().get("oldCar").isNull());
        assertTrue(v.toJson().get("currentCar").isNull());
    }

    @Test
    void aConfirmedReturnMovesOldToReturnedAndLeavesNoCurrentCar() throws Exception {
        Applied a = apply(returned(), source);
        assertInstanceOf(Outcome.Committed.class, a.outcome());
        assertTrue(a.applied().applied());
        CurrentCarView v = a.applied().relationship();
        assertEquals("returned", v.oldCar().status());
        assertEquals(RETURNED_AT, v.oldCar().returnedAt());
        assertEquals("SYN-RET-AAAAAAAAAAAA", v.oldCar().providerReference());
        assertEquals("BMW Park Lane", v.oldCar().location().get("label").asText());
        assertEquals("on-order", v.newCar().status());
        assertNull(v.currentCar());
        assertEquals(1, v.changes().size());
        assertEquals("return-confirmed", v.changes().get(0).type());
        assertEquals(RETURNED_AT, v.changes().get(0).at());
        assertEquals("return", v.changes().get(0).appointment().get("purpose").asText());
        assertEquals(1, rows("current_car_relationships"));
        assertEquals(1, rows("current_car_events"));
        assertEquals("returned", store.read(f.ctx(), "order-1", source).oldCar().status());
        assertEquals(2, f.count("SELECT version FROM current_car_relationships WHERE order_uuid = 'order-1'"));
    }

    @Test
    void aCompletedHandoverMakesTheNewCarCurrent() throws Exception {
        apply(returned(), source);
        Applied a = apply(collected(), source);
        CurrentCarView v = a.applied().relationship();
        assertTrue(a.applied().applied());
        assertEquals("collected", v.newCar().status());
        assertEquals(VIN, v.newCar().vin());
        assertEquals(COLLECTED_AT, v.newCar().collectedAt());
        ObjectNode current = v.currentCar();
        assertEquals("order", current.get("kind").asText());
        assertEquals("order-1", current.get("orderUuid").asText());
        assertEquals(VIN, current.get("vin").asText());
        assertEquals(2, v.changes().size());
        assertEquals("handover-completed", v.changes().get(0).type());
        assertEquals("return-confirmed", v.changes().get(1).type());
        assertEquals(2, rows("current_car_events"));
        assertEquals(1, rows("current_car_relationships"));
    }

    @Test
    void aHandoverFirstKeepsTheOldCarCurrentThenNothingChangesUntilCollected() throws Exception {
        CurrentCarView v = apply(collected(), source).applied().relationship();
        assertEquals("order", v.currentCar().get("kind").asText());
        assertEquals("held", v.oldCar().status());
        CurrentCarView both = apply(returned(), source).applied().relationship();
        assertEquals("order", both.currentCar().get("kind").asText());
        assertEquals("returned", both.oldCar().status());
    }

    @Test
    void aRepeatWithTheSameInputIsANoOp() throws Exception {
        apply(returned(), source);
        long revision = f.count("SELECT revision FROM runs WHERE run_id = 'run-1'");
        Applied again = apply(returned(), source);
        assertFalse(again.applied().applied());
        assertEquals("returned", again.applied().relationship().oldCar().status());
        assertEquals(1, again.applied().relationship().changes().size());
        assertEquals(1, rows("current_car_events"));
        assertEquals(revision, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }

    @Test
    void theSameEventWithChangedInputIsAConflict() throws Exception {
        apply(returned(), source);
        CurrentCarEvent changed = new CurrentCarEvent("return-confirmed", "order-1", "emp-1", RETURNED_AT.plusSeconds(60),
                "SYN-RET-BBBBBBBBBBBB", "contract-1", null, null, "slot-20261107T0900Z", "SYN-APT-111111111111");
        Applied a = apply(changed, source);
        assertEquals("idempotency-input-changed", a.refusedCode());
        assertEquals("idempotency-input-changed", a.outcome().code());
        assertEquals("SYN-RET-AAAAAAAAAAAA", f.text("SELECT old_provider_reference FROM current_car_relationships"));
        assertEquals(1, rows("current_car_events"));
    }

    @Test
    void aReturnedContractThatIsNotTheOrdersOldContractIsAnIdentityMismatch() throws Exception {
        CurrentCarEvent other = new CurrentCarEvent("return-confirmed", "order-1", "emp-1", RETURNED_AT, "SYN-RET-AAAAAAAAAAAA",
                "contract-other", null, null, "slot-20261107T0900Z", "SYN-APT-111111111111");
        assertEquals("current-car-identity-mismatch", apply(other, source).refusedCode());
        assertEquals(0, rows("current_car_relationships"));
    }

    @Test
    void aNewOrderRefusesAReturn() throws Exception {
        ReturnSource fresh = InMemoryReturnSource.newOrder("order-1", "emp-1");
        assertEquals("return-not-applicable", apply(returned(), fresh).refusedCode());
        assertEquals(0, rows("current_car_relationships"));
        CurrentCarView v = apply(collected(), fresh).applied().relationship();
        assertNull(v.oldCar());
        assertEquals("order", v.currentCar().get("kind").asText());
    }

    @Test
    void anotherEmployeesEventIsForbidden() throws Exception {
        CurrentCarEvent theirs = new CurrentCarEvent("return-confirmed", "order-1", "emp-2", RETURNED_AT, "SYN-RET-AAAAAAAAAAAA",
                "contract-1", null, null, "slot-20261107T0900Z", "SYN-APT-111111111111");
        Applied a = apply(theirs, source);
        assertEquals("forbidden", a.refusedCode());
        assertEquals(0, rows("current_car_events"));
    }

    @Test
    void onlyTheTwoConfirmedEventTypesAndWellFormedEventsAreAccepted() throws Exception {
        CurrentCarEvent scheduled = new CurrentCarEvent("return-scheduled", "order-1", "emp-1", RETURNED_AT, "ref", "contract-1",
                null, null, "slot", "ref");
        assertEquals("invalid-current-car-event", apply(scheduled, source).refusedCode());
        CurrentCarEvent badVin = new CurrentCarEvent("handover-completed", "order-1", "emp-1", COLLECTED_AT, "ref", null,
                "NOT-A-VIN", null, "slot", "ref");
        assertEquals("invalid-current-car-event", apply(badVin, source).refusedCode());
        CurrentCarEvent noContract = new CurrentCarEvent("return-confirmed", "order-1", "emp-1", RETURNED_AT, "ref", null,
                null, null, "slot", "ref");
        assertEquals("invalid-current-car-event", apply(noContract, source).refusedCode());
        CurrentCarEvent otherOrder = new CurrentCarEvent("handover-completed", "order-9", "emp-1", COLLECTED_AT, "ref", null,
                null, null, "slot", "ref");
        assertEquals("invalid-current-car-event", apply(otherOrder, source).refusedCode());
        assertEquals(0, rows("current_car_relationships"));
    }

    @Test
    void theForwardOnlyTriggerRefusesAReversal() throws Exception {
        apply(returned(), source);
        apply(collected(), source);
        assertThrows(SQLException.class, () -> f.update("UPDATE current_car_relationships SET old_status = 'held', "
                + "old_returned_at = NULL, old_provider_reference = NULL"));
        assertThrows(SQLException.class, () -> f.update("UPDATE current_car_relationships SET new_status = 'on-order', "
                + "new_collected_at = NULL, new_provider_reference = NULL, new_vin = NULL"));
        assertThrows(SQLException.class, () -> f.update("UPDATE current_car_relationships SET employee_id = 'emp-2'"));
        assertThrows(SQLException.class, () -> f.update("DELETE FROM current_car_relationships"));
        assertThrows(SQLException.class, () -> f.update("UPDATE current_car_events SET provider_reference = 'x'"));
        assertEquals("returned", f.text("SELECT old_status FROM current_car_relationships"));
    }

    @Test
    void aRollbackOfTheCallersTransactionLeavesNothing() throws Exception {
        assertThrows(IllegalStateException.class, () -> runner.execute(f.ctx(),
                new Command("current-car", "cmd-rollback", ReturnJson.JSON.createObjectNode().put("n", 1)), tx -> {
                    assertTrue(((CurrentCarResult.Applied) store.apply(tx, returned(), source)).applied());
                    throw new IllegalStateException("caller fails after applying");
                }));
        assertEquals(0, rows("current_car_relationships"));
        assertEquals(0, rows("current_car_events"));
        assertEquals("held", store.read(f.ctx(), "order-1", source).oldCar().status());
        assertEquals(0, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }

    @Test
    void theRunRevisionAdvancesOnceForACommandThatApplies() throws Exception {
        apply(returned(), source);
        assertEquals(1, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }
}
