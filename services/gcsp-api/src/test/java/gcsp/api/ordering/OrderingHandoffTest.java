package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.persistence.RunContext;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** Exactly one external submission: lost answers, repeats, races, leases, restarts and the order source. */
class OrderingHandoffTest {

    @Test
    void aLostAcknowledgementIsPendingThenReconcilesToOneReceiptAndOneExecute() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.loseAnswer = true;
            OrderingResult first = f.submit("e1", "c1");
            String id = assertInstanceOf(OrderingResult.Pending.class, first).operationId();
            assertEquals("pending", OrderingFixture.status(first));
            assertEquals("handoff-pending", OrderingFixture.value(first).path("view").path("state").asText());
            assertEquals(1, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            assertEquals("selection-pending", assertInstanceOf(OrderSourcePort.NotReady.class,
                    new OrderingOrderSource(f.pool()).find(f.ctx(), "car-e1")).code());
            f.provider.loseAnswer = false;
            OrderingResult next = f.service.reconcile(f.scope("e1"), id);
            assertEquals("acknowledged", OrderingFixture.status(next));
            assertEquals(1, f.provider.executes.get());
            assertEquals(1, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
        }
    }

    @Test
    void aRejectionIsRefusedAndNeverAcknowledged() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.reject = true;
            OrderingResult r = f.submit("e1", "c1");
            assertEquals("refused", OrderingFixture.status(r));
            assertEquals("contact-support", OrderingFixture.value(r).path("view").path("action").asText());
            assertEquals(0, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            var found = assertInstanceOf(OrderSourcePort.NotReady.class, new OrderingOrderSource(f.pool()).find(f.ctx(), "car-e1"));
            assertEquals("selection-handoff-failed", found.code());
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-refused'"));
            // Refused stays refused: a repeat replays it and a changed intent is still the active selection.
            f.provider.reject = false;
            assertEquals("refused", OrderingFixture.status(f.submit("e1", "c2")));
            assertEquals(1, f.provider.executes.get());
            var changed = f.body("e1", false, "c3");
            changed.put("expectedStockVersion", 2);
            assertEquals("active-selection-exists", assertInstanceOf(OrderingResult.Refused.class,
                    f.service.submit(f.scope("e1"), changed, f.cart)).code());
        }
    }

    @Test
    void aRepeatedCommandReplaysAndAChangedBodyIsTheActiveSelection() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            OrderingResult first = f.submit("e1", "c1");
            OrderingResult again = f.submit("e1", "c1");
            OrderingResult fresh = f.submit("e1", "c2");
            assertTrue(assertInstanceOf(OrderingResult.Ok.class, again).replayed());
            assertTrue(assertInstanceOf(OrderingResult.Ok.class, fresh).replayed());
            assertEquals(OrderingFixture.value(first).get("operationId"), OrderingFixture.value(fresh).get("operationId"));
            assertEquals(1, f.provider.executes.get());
            assertEquals(1, f.cart.converts.get());
            var changed = f.body("e1", false, "c3");
            changed.put("expectedQuoteId", "q-else");
            assertEquals("active-selection-exists", assertInstanceOf(OrderingResult.Refused.class,
                    f.service.submit(f.scope("e1"), changed, f.cart)).code());
            assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
        }
    }

    @Test
    void concurrentIdenticalSubmitsMakeOneIntentAndOneExecute() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            ExecutorService pool = Executors.newFixedThreadPool(2);
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            try {
                List<Future<OrderingResult>> runs = List.of(
                        pool.submit(() -> gated(ready, go, f, "ca")), pool.submit(() -> gated(ready, go, f, "cb")));
                ready.await();
                go.countDown();
                OrderingResult a = runs.get(0).get(60, TimeUnit.SECONDS);
                OrderingResult b = runs.get(1).get(60, TimeUnit.SECONDS);
                assertEquals(OrderingFixture.value(a).get("operationId"), OrderingFixture.value(b).get("operationId"));
                assertEquals(1, f.count("SELECT count(*) FROM pending_operations"));
                assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
                assertEquals(1, f.provider.executes.get());
                assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
            } finally {
                pool.shutdownNow();
            }
        }
    }

    private static OrderingResult gated(CountDownLatch ready, CountDownLatch go, OrderingFixture f, String command) throws Exception {
        ready.countDown();
        go.await();
        return f.submit("e1", command);
    }

    @Test
    void aHeldLeaseStopsASecondProviderCall() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.entered = new CountDownLatch(1);
            f.provider.release = new CountDownLatch(1);
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try {
                Future<OrderingResult> first = pool.submit(() -> f.submit("e1", "c1"));
                assertTrue(f.provider.entered.await(30, TimeUnit.SECONDS));
                String id = OrderingService.operationId(f.scope("e1"));
                OrderingResult second = f.service.drive(f.scope("e1"), id);
                assertEquals("pending", OrderingFixture.status(second));
                assertEquals(1, f.provider.executes.get());
                f.provider.release.countDown();
                assertEquals("acknowledged", OrderingFixture.status(first.get(30, TimeUnit.SECONDS)));
                assertEquals(1, f.provider.executes.get());
            } finally {
                f.provider.release.countDown();
                pool.shutdownNow();
            }
        }
    }

    @Test
    void anExpiredLeaseLetsALaterDriverReconcileFirst() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.down = true;
            String id = assertInstanceOf(OrderingResult.Pending.class, f.submit("e1", "c1")).operationId();
            assertEquals("unknown", f.text("SELECT outcome->>'status' FROM pending_operations"));
            assertEquals(0, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            f.provider.down = false;
            f.update("UPDATE selection_orders SET handoff_lease_until = ?", java.sql.Timestamp.from(OrderingFixture.NOW.plusSeconds(60)));
            assertEquals("pending", OrderingFixture.status(f.service.reconcile(f.scope("e1"), id)));
            f.wall.set(OrderingFixture.NOW.plusSeconds(61));
            assertEquals("acknowledged", OrderingFixture.status(f.service.reconcile(f.scope("e1"), id)));
        }
    }

    @Test
    void aRestartReconcilesAnOpenIntentWithoutASecondExecuteAndNeverFabricatesOne() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.loseAnswer = true;
            f.submit("e1", "c1");
            f.provider.down = true;
            f.provider.loseAnswer = false;
            // A restarted service over a new pool, with the provider still failing: stays pending, nothing invented.
            var down = new OrderingFixture.TestProvider(new SyntheticOrderingProvider(f.pool()));
            down.down = true;
            OrderingService stuck = f.newService(f.pool(), down);
            var out = assertInstanceOf(OrderingResult.Ok.class, stuck.reconcileOpen(f.ctx(), 10));
            assertEquals(1, out.value().get("examined").asInt());
            assertEquals(1, out.value().get("stillPending").asInt());
            assertEquals("pending", f.text("SELECT state FROM pending_operations"));
            f.wall.set(OrderingFixture.NOW.plusSeconds(120));
            var healthy = new OrderingFixture.TestProvider(new SyntheticOrderingProvider(f.pool()));
            OrderingService restarted = f.newService(f.pool(), healthy);
            out = assertInstanceOf(OrderingResult.Ok.class, restarted.reconcileOpen(f.ctx(), 10));
            assertEquals(1, out.value().get("settled").asInt());
            assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
            assertEquals(0, healthy.executes.get());
            assertEquals(1, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            assertEquals("invalid", assertInstanceOf(OrderingResult.Refused.class, restarted.reconcileOpen(f.ctx(), 0)).code());
        }
    }

    @Test
    void anUnknownProviderNameStopsStartupAndNoneIsUnconfigured() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                    () -> OrderingProviderSelection.select("live", f.pool()));
            assertEquals("none", OrderingProviderSelection.select(null, f.pool()).mode());
            assertEquals("synthetic", OrderingProviderSelection.select("synthetic", f.pool()).mode());
        }
    }

    @Test
    void theOrderSourceFindsListsAndRefusesDuplicates() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            var source = new OrderingOrderSource(f.pool());
            assertInstanceOf(OrderSourcePort.NotFound.class, source.find(f.ctx(), "car-e1"));
            f.submit("e1", "c1");
            f.submit("e2", "c2");
            var ready = assertInstanceOf(OrderSourcePort.Ready.class, source.find(f.ctx(), "car-e1")).order();
            assertEquals("manual", ready.route());
            assertEquals("e1", ready.employeeId());
            assertEquals("slot-e1", ready.entitlementSlotId());
            assertEquals(List.of("HR approval", "sales-manager approval", "sent to ordering"), ready.approvalStages());
            assertEquals("GCSP-000001", ready.source().path("orderReference").asText());
            assertEquals(ready.providerReference(), ready.source().path("providerReference").asText());
            var one = assertInstanceOf(OrderSourcePort.Page.class, source.list(f.ctx(), null, 1));
            assertEquals(List.of("car-e1"), one.orders().stream().map(OrderSourcePort.SelectionOrder::orderUuid).toList());
            assertEquals("car-e1", one.nextAfter());
            var rest = assertInstanceOf(OrderSourcePort.Page.class, source.list(f.ctx(), one.nextAfter(), 5));
            assertEquals(List.of("car-e2"), rest.orders().stream().map(OrderSourcePort.SelectionOrder::orderUuid).toList());
            assertEquals(null, rest.nextAfter());
            // A second acknowledged operation for the same car (a third employee's row) is a duplicate, not a choice.
            f.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES ('test-env', 'run-1', 'e3')");
            f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES ('test-env', 'run-1', 'slot-e3', 'e3', 1)");
            f.update("INSERT INTO pending_operations (environment_id, run_id, operation_id, operation_type, idempotency_key, "
                    + "input_digest, state, provider_reference, outcome, version) SELECT environment_id, run_id, 'dup', operation_type, 'dup', "
                    + "input_digest, state, provider_reference, outcome, version FROM pending_operations WHERE operation_id LIKE 'selection:%' "
                    + "ORDER BY created_at LIMIT 1");
            f.update("INSERT INTO selection_orders (environment_id, run_id, operation_id, employee_id, entitlement_slot_id, source_type, "
                    + "hold_id, order_uuid, order_reference, policy_version, selection, received_at) SELECT environment_id, run_id, 'dup', "
                    + "'e3', 'slot-e3', source_type, hold_id, order_uuid, 'GCSP-DUP', policy_version, selection, received_at "
                    + "FROM selection_orders WHERE order_uuid = 'car-e1'");
            assertInstanceOf(OrderSourcePort.Duplicate.class, source.find(f.ctx(), "car-e1"));
            // An acknowledged row whose provider outcome is unreadable is invalid, never ready.
            f.update("UPDATE pending_operations SET outcome = NULL WHERE operation_id = 'dup'");
            f.update("UPDATE pending_operations SET state = 'refused' WHERE operation_id = (SELECT operation_id FROM selection_orders "
                    + "WHERE employee_id = 'e1')");
            assertInstanceOf(OrderSourcePort.Invalid.class, source.find(f.ctx(), "car-e1"));
            var page = assertInstanceOf(OrderSourcePort.Page.class, source.list(f.ctx(), null, 10));
            assertEquals(List.of("car-e1"), page.invalid().stream().map(OrderSourcePort.InvalidRow::orderUuid).toList());
        }
    }

    @Test
    void anIntentOnlyRestartCompletesTheConfirmedHandoffWithOneExecute() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.down = true;
            f.submit("e1", "c1");
            assertEquals(0, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            var healthy = new OrderingFixture.TestProvider(new SyntheticOrderingProvider(f.pool()));
            OrderingService restarted = f.newService(f.pool(), healthy);
            var out = assertInstanceOf(OrderingResult.Ok.class, restarted.reconcileOpen(f.ctx(), 10));
            assertEquals(1, out.value().get("settled").asInt());
            assertEquals(1, healthy.executes.get());
            assertEquals(1, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
        }
    }

    @Test
    void theOutcomeEventIsStampedWithTheRunClockNotTheWallClock() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.wall.set(OrderingFixture.NOW.plusSeconds(500));
            assertEquals("acknowledged", OrderingFixture.status(f.submit("e1", "c1")));
            assertEquals("2026-11-13T12:00:00.000Z", f.text("SELECT payload->>'occurredAt' FROM outbox_events "
                    + "WHERE event_type = 'ordering.selection-acknowledged'"));
        }
    }

    @Test
    void aPresenterOrStartupReconcileRecordsItsOwnActor() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.provider.down = true;
            f.submit("e1", "c1");
            f.provider.down = false;
            var out = assertInstanceOf(OrderingResult.Ok.class,
                    f.service.reconcileOpen(new RunContext(OrderingFixture.ENV, OrderingFixture.RUN, "presenter:p1"), 10));
            assertEquals(1, out.value().get("settled").asInt());
            assertEquals(2, f.count("SELECT count(*) FROM command_receipts WHERE actor_id = 'presenter:p1' "
                    + "AND command_type IN ('ordering.claim', 'ordering.finish')"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE actor_id = 'presenter:p1' "
                    + "AND event_type = 'ordering.selection-acknowledged'"));
            assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE actor_id = 'e1' AND command_type = 'ordering.submit'"));
        }
    }

    @Test
    void aPendingHandoffIsNotRetriedInsideTheBackoffWindow() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            OrderingService backed = f.newService(f.pool(), f.provider, java.time.Duration.ofSeconds(5), ctx -> OrderingFixture.NOW);
            f.provider.down = true;
            String id = assertInstanceOf(OrderingResult.Pending.class,
                    backed.submit(f.scope("e1"), f.body("e1", false, "c1"), f.cart)).operationId();
            long receipts = f.count("SELECT count(*) FROM command_receipts");
            int reconciles = f.provider.reconciles.get();
            f.provider.down = false;
            for (int i = 0; i < 2; i++) {
                assertEquals("pending", OrderingFixture.status(backed.drive(f.scope("e1"), id)));
                assertEquals(receipts, f.count("SELECT count(*) FROM command_receipts"));
                assertEquals(reconciles, f.provider.reconciles.get());
            }
            assertEquals(0, assertInstanceOf(OrderingResult.Ok.class, backed.reconcileOpen(f.ctx(), 10)).value().get("examined").asInt());
            f.wall.set(OrderingFixture.NOW.plusSeconds(6));
            assertEquals("acknowledged", OrderingFixture.status(backed.drive(f.scope("e1"), id)));
        }
    }
}
