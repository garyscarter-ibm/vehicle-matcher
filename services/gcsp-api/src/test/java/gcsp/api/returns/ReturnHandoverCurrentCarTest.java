package gcsp.api.returns;

import static gcsp.api.returns.PlansHarness.EMP;
import static gcsp.api.returns.PlansHarness.HANDOVER_SLOT;
import static gcsp.api.returns.PlansHarness.ORDER;
import static gcsp.api.returns.PlansHarness.ok;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** A completed handover (the appointments outbox event) makes the new car current once, at the event's time. */
class ReturnHandoverCurrentCarTest {

    static final Instant AT = Instant.parse("2026-11-07T09:42:00Z");
    static final String REF = "SYN-APT-COMPLETE1";

    @TempDir Path dir;
    PlansHarness h;

    @BeforeEach
    void setUp() throws Exception {
        h = new PlansHarness(dir, d -> {});
    }

    @AfterEach
    void tearDown() throws Exception {
        if (h != null) h.close();
    }

    /** Commits the event as appointments does: one command that changes data and emits the six payload keys. */
    void complete(String opId, String order, String employee) throws Exception {
        ObjectNode payload = ReturnJson.JSON.createObjectNode().put("orderUuid", order).put("employeeId", employee)
                .put("occurredAt", ReturnJson.format(AT)).put("providerReference", REF)
                .put("slotId", HANDOVER_SLOT.slotId()).put("policyVersion", "test-policy-v1");
        Outcome o = new TransactionRunner(h.f.pool()).execute(h.ctx(), new Command("test-complete", opId, payload), tx -> {
            tx.write("UPDATE runs SET status = status WHERE environment_id = ? AND run_id = ?", h.ctx().environmentId(),
                    h.ctx().runId());
            tx.emit(opId, "appointment-completed", payload);
            return WorkResult.ok(payload);
        });
        assertInstanceOf(Outcome.Committed.class, o, String.valueOf(o));
    }

    long events() throws Exception {
        return h.f.count("SELECT count(*) FROM current_car_events WHERE event_type = 'handover-completed'");
    }

    long version() throws Exception {
        return h.f.count("SELECT version FROM current_car_relationships WHERE order_uuid = ?", ORDER);
    }

    @Test
    void aCompletionMakesTheNewCarCurrentOnceAndSurvivesRestart() throws Exception {
        complete("op-complete-1", ORDER, EMP);
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(1, s.applied());
        assertTrue(s.failed().isEmpty());
        assertEquals("collected", h.f.text("SELECT new_status FROM current_car_relationships WHERE order_uuid = ?", ORDER));
        assertEquals("held", h.f.text("SELECT old_status FROM current_car_relationships WHERE order_uuid = ?", ORDER));
        assertEquals(AT, Instant.parse(h.f.text("SELECT to_char(new_collected_at AT TIME ZONE 'UTC', "
                + "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM current_car_relationships WHERE order_uuid = ?", ORDER)));
        assertEquals(REF, h.f.text("SELECT new_provider_reference FROM current_car_relationships WHERE order_uuid = ?", ORDER));
        assertEquals(1, events());
        CurrentCarStore store = new CurrentCarStore(h.f.pool());
        CurrentCarView v = store.read(h.ctx(), ORDER, InMemoryReturnSource.replacement(ORDER, EMP));
        assertEquals("collected", v.newCar().status());
        assertEquals(AT, v.newCar().collectedAt());
        assertEquals("held", v.oldCar().status());
        assertEquals(1, store.listForEmployee(h.ctx(), EMP).size());
        assertEquals("collected", store.listForEmployee(h.ctx(), EMP).get(0).newCar().status());

        long version = version();
        assertEquals(0, h.progress(true).applied());
        assertEquals(0, h.progress(false).applied());
        h.restart(h.provider);
        assertEquals(0, h.progress(false).applied());
        assertEquals(0, h.progress(true).applied());
        assertEquals(version, version());
        assertEquals(1, events());
    }

    @Test
    void noEventWritesNothing() throws Exception {
        assertEquals(0, h.progress(true).applied());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals(0, events());
    }

    @Test
    void anOrderWithNoSelectionRecordIsSkippedWithoutFailure() throws Exception {
        complete("op-complete-x", "order-unknown", EMP);
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(0, s.applied());
        assertTrue(s.failed().isEmpty());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
    }

    @Test
    void anUnavailableSourceFailsThenAppliesExactlyOnceWhenItAnswers() throws Exception {
        h.source.put(ORDER, new ReturnSourceReading.Unavailable("source-unavailable", true, "Try again."));
        complete("op-complete-2", ORDER, EMP);
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(0, s.applied());
        assertEquals(List.of(new ReturnPlans.Failure(ORDER, "source-unavailable")), s.failed());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals(0, events());

        h.source.put(InMemoryReturnSource.replacement(ORDER, EMP));
        assertEquals(1, h.progress(false).applied());
        assertEquals(1, events());
        assertEquals(0, h.progress(true).applied());
        assertEquals(1, events());
    }

    @Test
    void anEventForAnotherEmployeeFailsAndWritesNothing() throws Exception {
        complete("op-complete-3", ORDER, "emp-other");
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(0, s.applied());
        assertEquals(List.of(new ReturnPlans.Failure(ORDER, "current-car-identity-mismatch")), s.failed());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals(0, events());
    }

    @Test
    void aPlanWithoutACompletionNeverChangesTheCurrentCar() throws Exception {
        ok(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        h.advance(1800);
        assertEquals(1, h.progress(true).applied());
        assertEquals(0, h.progress(true).applied());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals("on-order", new CurrentCarStore(h.f.pool())
                .read(h.ctx(), ORDER, InMemoryReturnSource.replacement(ORDER, EMP)).newCar().status());
        assertEquals(0, events());
    }
}
