package gcsp.api.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Reconcile applies real provider responses, queues confirmations into supply and signals a replan. */
class ProductionReconcileTest {

    private static final Instant T1 = ProductionFixture.T0.plusSeconds(3600);

    private static ProductionFixture submitted() throws Exception {
        ProductionFixture f = ProductionFixture.create();
        f.submit("cmd-1");
        f.advance(T1);
        return f;
    }

    private static JsonNode request(JsonNode status, String lineId) {
        for (JsonNode r : status.get("requests")) if (lineId.equals(r.get("lineId").asText())) return r;
        throw new AssertionError("no line " + lineId);
    }

    private static JsonNode statusOf(ProductionFixture f) {
        return ProductionFixture.value(f.service.status(f.ctx()));
    }

    private static void script(ProductionFixture f, String lineId, String action, Integer qty) throws Exception {
        assertTrue(f.synthetic.script(f.ctx(), f.requestId(lineId), action, qty, null, null, T1).ok());
    }

    @Test
    void partialConfirmationIsAppliedQueuedAndSignalledOnce() throws Exception {
        try (ProductionFixture f = submitted()) {
            script(f, "l1", "confirm", 2);
            ProductionResult.Ok r = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcile(f.ctx(), 10));
            assertEquals(2, r.value().get("reconciled").asInt());
            assertEquals(1, r.value().get("applied").asInt());
            assertEquals(1, r.value().get("queued").asInt());
            assertEquals("partly-confirmed", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(1, f.count("SELECT count(*) FROM confirmed_supply_queue"));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NOT NULL"));
            assertEquals(T1.plusSeconds(3 * 86400).toEpochMilli(), Long.parseLong(
                    f.text("SELECT (extract(epoch FROM eligible_from) * 1000)::bigint FROM confirmed_supply_queue")));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                    + "AND payload->>'state' = 'partly-confirmed'"));
            JsonNode payload = new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                    f.text("SELECT payload::text FROM outbox_events WHERE event_type = 'production.supply-changed' "
                            + "AND event_id LIKE ? AND payload->>'state' = 'partly-confirmed'", "production:" + f.requestId("l1") + ":%"));
            assertEquals("partly-confirmed", payload.get("state").asText());
            assertEquals(2, payload.get("confirmedQuantity").asInt());
            assertEquals(5, payload.get("quantity").asInt());

            JsonNode l1 = request(statusOf(f), "l1");
            assertEquals(2, l1.get("confirmedQuantity").asInt());
            assertEquals(2, l1.get("queuedQuantity").asInt());
            assertEquals(0, l1.get("releasedQuantity").asInt());
            assertEquals(3, l1.get("outstandingQuantity").asInt());
            assertEquals("partly-confirmed", l1.get("stage").asText());
            assertEquals(1, l1.get("supplies").size());
            assertTrue(l1.get("supplies").get(0).get("queued").asBoolean());
        }
    }

    @Test
    void confirmingTheRestThenReconcilingAgainChangesNothing() throws Exception {
        try (ProductionFixture f = submitted()) {
            script(f, "l1", "confirm", 2);
            f.service.reconcile(f.ctx(), 10);
            script(f, "l1", "confirm", 3);
            f.service.reconcile(f.ctx(), 10);
            assertEquals("confirmed", f.stateOf("l1"));
            assertEquals(2, f.count("SELECT count(*) FROM confirmed_supply_queue"));
            String version = ProductionFixture.value(f.service.supplyActivity(f.ctx())).get("supplyVersion").asText();
            long history = f.count("SELECT count(*) FROM production_responses");
            long events = f.count("SELECT count(*) FROM outbox_events");
            ProductionResult.Ok again = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcile(f.ctx(), 10));
            assertEquals(0, again.value().get("applied").asInt());
            assertEquals(0, again.value().get("queued").asInt());
            assertEquals(history, f.count("SELECT count(*) FROM production_responses"));
            assertEquals(events, f.count("SELECT count(*) FROM outbox_events"));
            assertEquals(version, ProductionFixture.value(f.service.supplyActivity(f.ctx())).get("supplyVersion").asText());
            assertEquals("confirmed", request(statusOf(f), "l1").get("stage").asText());
        }
    }

    @Test
    void delayThenConfirmAndRefusalBeforeConfirmationAreBothApplied() throws Exception {
        try (ProductionFixture f = submitted()) {
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "delay", null, T1.plusSeconds(86400), "Plant stop", T1).ok());
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l2"), "refuse", null, null, "Out of capacity", T1).ok());
            f.service.reconcile(f.ctx(), 10);
            assertEquals("delayed", f.stateOf("l1"));
            assertEquals("refused", f.stateOf("l2"));
            JsonNode l2 = request(statusOf(f), "l2");
            assertEquals("Out of capacity", l2.get("reason").asText());
            assertEquals(0, l2.get("confirmedQuantity").asInt());
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE payload->>'state' = 'delayed'"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE payload->>'state' = 'refused'"));
            script(f, "l1", "confirm", 5);
            f.service.reconcile(f.ctx(), 10);
            assertEquals("confirmed", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE payload->>'state' = 'confirmed'"));
            assertEquals(1, f.count("SELECT count(*) FROM production_requests WHERE state IN ('refused')"));
        }
    }

    @Test
    void anUnavailableSupplyQueueLeavesTheConfirmationWaitingAndTheNextPassQueuesItOnce() throws Exception {
        try (ProductionFixture f = submitted()) {
            SupplyQueuePort real = f.queue.delegate;
            f.queue.delegate = (scope, cmd, now, id, at, v) -> new SupplyQueuePort.Unavailable("down", "The queue is down.");
            script(f, "l1", "confirm", 2);
            f.service.reconcile(f.ctx(), 10);
            assertEquals("partly-confirmed", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NULL"));
            assertEquals(0, f.count("SELECT count(*) FROM confirmed_supply_queue"));
            JsonNode l1 = request(statusOf(f), "l1");
            assertEquals(0, l1.get("queuedQuantity").asInt());
            assertTrue(l1.get("message").asText().contains("Confirmed. Waiting to join the release queue."));
            String before = ProductionFixture.value(f.service.supplyActivity(f.ctx())).get("supplyVersion").asText();

            f.queue.delegate = real;
            ProductionResult.Ok r = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcile(f.ctx(), 10));
            assertEquals(1, r.value().get("queued").asInt());
            assertEquals(0, r.value().get("applied").asInt());
            assertEquals(1, f.count("SELECT count(*) FROM confirmed_supply_queue"));
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NULL"));
            assertFalse(before.equals(ProductionFixture.value(f.service.supplyActivity(f.ctx())).get("supplyVersion").asText()));
            long calls = f.queue.calls.get();
            f.service.reconcile(f.ctx(), 10);
            assertEquals(calls, f.queue.calls.get());
        }
    }

    @Test
    void anUnconfiguredQueueAndAnUncertainQueueKeepConfirmationsUnqueued() throws Exception {
        try (ProductionFixture f = submitted()) {
            script(f, "l1", "confirm", 1);
            f.queue.delegate = new UnconfiguredSupplyQueue();
            f.service.reconcile(f.ctx(), 10);
            f.queue.delegate = (scope, cmd, now, id, at, v) -> new SupplyQueuePort.Uncertain();
            f.service.reconcile(f.ctx(), 10);
            f.queue.delegate = (scope, cmd, now, id, at, v) -> new SupplyQueuePort.Conflict("confirmation-input-changed", "Changed.");
            f.service.reconcile(f.ctx(), 10);
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NULL"));
            assertEquals("partly-confirmed", f.stateOf("l1"));
        }
    }

    @Test
    void anUncertainRowWhoseProviderHasNoRecordStaysUncertainAndNothingIsSubmitted() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            ProductionFixture.Wrapper w = new ProductionFixture.Wrapper(f.synthetic, ProductionFixture.Wrapper.Mode.DOWN_BEFORE_RECORDING, 99);
            f.use(w);
            assertInstanceOf(ProductionResult.Pending.class, f.submit("cmd-1"));
            assertEquals("uncertain", f.stateOf("l1"));
            int submits = w.submits.get();
            long attempts = f.count("SELECT attempts FROM production_requests WHERE line_id = 'l1'");
            ProductionResult.Ok r = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcile(f.ctx(), 10));
            assertEquals(0, r.value().get("applied").asInt());
            assertEquals(submits, w.submits.get());
            assertEquals("uncertain", f.stateOf("l1"));
            assertEquals(attempts + 1, f.count("SELECT attempts FROM production_requests WHERE line_id = 'l1'"));
            assertEquals(0, f.count("SELECT count(*) FROM production_synthetic_orders"));
        }
    }

    @Test
    void aProviderThatThrowsDuringReconcileOnlyRecordsTheAttempt() throws Exception {
        try (ProductionFixture f = submitted()) {
            f.use(new ProductionFixture.Scripted(op -> {
                throw new IllegalStateException("provider down");
            }));
            long history = f.count("SELECT count(*) FROM production_responses");
            ProductionResult.Ok r = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcile(f.ctx(), 10));
            assertEquals(0, r.value().get("applied").asInt());
            assertEquals("requested", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT attempts FROM production_requests WHERE line_id = 'l1'"));
            assertEquals("no-usable-answer", f.text("SELECT last_outcome->>'code' FROM production_requests WHERE line_id = 'l1'"));
            assertEquals(history, f.count("SELECT count(*) FROM production_responses"));
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
        }
    }

    @Test
    void reconcileRefusesBadLimitsAnUnconfiguredProviderAndUnknownRequests() throws Exception {
        try (ProductionFixture f = submitted()) {
            assertEquals("invalid-limit", assertInstanceOf(ProductionResult.Invalid.class, f.service.reconcile(f.ctx(), 0)).code());
            assertEquals("invalid-limit", assertInstanceOf(ProductionResult.Invalid.class, f.service.reconcile(f.ctx(), 101)).code());
            assertEquals("request-not-found", assertInstanceOf(ProductionResult.Invalid.class,
                    f.service.reconcileRequest(f.ctx(), "request-none")).code());
            script(f, "l2", "confirm", 1);
            ProductionResult.Ok one = assertInstanceOf(ProductionResult.Ok.class, f.service.reconcileRequest(f.ctx(), f.requestId("l2")));
            assertEquals(1, one.value().get("reconciled").asInt());
            assertEquals(1, one.value().get("applied").asInt());
            assertEquals("partly-confirmed", f.stateOf("l2"));
            assertEquals("requested", f.stateOf("l1"));
            long footprint = f.count("SELECT count(*) FROM production_responses");
            f.use(new UnconfiguredProductionProvider());
            assertEquals("production-not-configured", assertInstanceOf(ProductionResult.Unavailable.class,
                    f.service.reconcile(f.ctx(), 10)).code());
            assertEquals(footprint, f.count("SELECT count(*) FROM production_responses"));
        }
    }

    @Test
    void releasedStockShowsAsSeparateQuantityAndInconsistentDataIsRefused() throws Exception {
        try (ProductionFixture f = submitted()) {
            script(f, "l1", "confirm", 2);
            f.service.reconcile(f.ctx(), 10);
            String supplyId = f.text("SELECT supply_id FROM production_confirmations");
            releaseStock(f, supplyId, 1);
            JsonNode l1 = request(statusOf(f), "l1");
            assertEquals(1, l1.get("releasedQuantity").asInt());
            assertEquals(2, l1.get("confirmedQuantity").asInt());
            assertEquals("partly-released", l1.get("stage").asText());
            assertEquals(1, ProductionFixture.value(f.service.supplyActivity(f.ctx())).get("requests").get(0).get("releasedQuantity").asInt());

            script(f, "l1", "confirm", 3);
            f.service.reconcile(f.ctx(), 10);
            releaseStock(f, f.text("SELECT supply_id FROM production_confirmations WHERE supply_id <> ?", supplyId), 3);
            // a second tranche brings the first supply to its full 2
            f.update("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, supply_id, tick_id, released_at, "
                    + "policy_version, source, input_digest, order_uuids, visible_order_uuids, outcome) VALUES "
                    + "('test-env', 'run-1', 'tranche-x', 'w', ?, 'tick-1', now(), 'p', '{}'::jsonb, ?, '[\"o9\"]'::jsonb, '[]'::jsonb, '{}'::jsonb)",
                    supplyId, "1".repeat(64));
            JsonNode full = request(statusOf(f), "l1");
            assertEquals(5, full.get("releasedQuantity").asInt());
            assertEquals("released", full.get("stage").asText());

            f.update("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, supply_id, tick_id, released_at, "
                    + "policy_version, source, input_digest, order_uuids, visible_order_uuids, outcome) VALUES "
                    + "('test-env', 'run-1', 'tranche-y', 'w', ?, 'tick-1', now(), 'p', '{}'::jsonb, ?, '[\"o10\"]'::jsonb, '[]'::jsonb, '{}'::jsonb)",
                    supplyId, "2".repeat(64));
            ProductionResult.Unavailable bad = assertInstanceOf(ProductionResult.Unavailable.class, f.service.status(f.ctx()));
            assertEquals("supply-quantities-disagree", bad.code());
            assertEquals("Supply quantities disagree with their release history.", bad.reason());
        }
    }

    private static void releaseStock(ProductionFixture f, String supplyId, int cars) throws Exception {
        StringBuilder ids = new StringBuilder("[");
        for (int i = 0; i < cars; i++) ids.append(i == 0 ? "" : ",").append("\"").append(supplyId, 7, 15).append("-").append(i).append("\"");
        ids.append("]");
        f.update("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, supply_id, tick_id, released_at, "
                + "policy_version, source, input_digest, order_uuids, visible_order_uuids, outcome) VALUES "
                + "('test-env', 'run-1', ?, 'w', ?, 'tick-1', now(), 'p', '{}'::jsonb, ?, ?::jsonb, '[]'::jsonb, '{}'::jsonb)",
                "tranche-" + supplyId, supplyId, "0".repeat(64), ids.toString());
    }

    @Test
    void replanFollowsTheSubmissionAndTheSupplyVersionTracksEveryChange() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            JsonNode none = ProductionFixture.value(f.service.supplyActivity(f.ctx()));
            assertEquals("no-submission", none.get("replan").get("status").asText());
            f.submit("cmd-1");
            f.advance(T1);
            JsonNode first = ProductionFixture.value(f.service.supplyActivity(f.ctx()));
            assertEquals("unchanged-since-submission", first.get("replan").get("status").asText());
            assertEquals("plan-1", first.get("replan").get("submittedPlanId").asText());
            assertEquals(2, first.get("requests").size());
            script(f, "l1", "confirm", 2);
            f.queue.delegate = (scope, cmd, now, id, at, v) -> new SupplyQueuePort.Unavailable("down", "down");
            f.service.reconcile(f.ctx(), 10);
            JsonNode applied = ProductionFixture.value(f.service.supplyActivity(f.ctx()));
            assertEquals("replanned", applied.get("replan").get("status").asText());
            assertEquals("partly-confirmed", applied.get("replan").get("after").get("state").asText());
            assertEquals(3, applied.get("responses").size());
            assertFalse(first.get("supplyVersion").equals(applied.get("supplyVersion")));
            f.queue.delegate = new StockReleaseSupplyQueue(f.realRelease(f.pool()));
            f.service.reconcile(f.ctx(), 10);
            JsonNode queued = ProductionFixture.value(f.service.supplyActivity(f.ctx()));
            assertFalse(applied.get("supplyVersion").equals(queued.get("supplyVersion")));
            assertEquals(64, queued.get("supplyVersion").asText().length());
        }
    }

    @Test
    void aNewServiceOverANewPoolReconcilesAScriptedResponseOnce() throws Exception {
        try (ProductionFixture f = submitted()) {
            script(f, "l1", "confirm", 5);
            var pool = f.pool();
            ProductionService restarted = f.service(pool, new SyntheticProductionProvider(pool));
            assertInstanceOf(ProductionResult.Ok.class, restarted.reconcile(f.ctx(), 10));
            assertInstanceOf(ProductionResult.Ok.class, restarted.reconcile(f.ctx(), 10));
            assertEquals("confirmed", f.stateOf("l1"));
            assertEquals(1, f.count("SELECT count(*) FROM production_responses WHERE request_id = ? AND state = 'confirmed'", f.requestId("l1")));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(1, f.count("SELECT count(*) FROM confirmed_supply_queue"));
        }
    }

    @Test
    void reconcileStatementCountDoesNotGrowWithOtherRunsRows() throws Exception {
        try (ProductionFixture f = submitted()) {
            AtomicInteger statements = new AtomicInteger();
            long before = measure(f, statements);
            f.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'run-2', 'retired', now())", ProductionFixture.ENV);
            for (int i = 0; i < 30; i++) {
                f.update("INSERT INTO production_submissions (environment_id, run_id, submission_id, command_id, requested_by, plan_id, "
                        + "plan_versions, input_digest, requested_at) VALUES (?, 'run-2', ?, 'c', 'g', ?, '{}'::jsonb, ?, now())",
                        ProductionFixture.ENV, "s" + i, "p" + i, "0".repeat(64));
                f.update("INSERT INTO production_requests (environment_id, run_id, request_id, submission_id, line_id, model, derivative, "
                        + "quantity, state, input_digest, requested_at) VALUES (?, 'run-2', ?, ?, 'l', 'm', 'd', 1, 'intent', ?, now())",
                        ProductionFixture.ENV, "r" + i, "s" + i, "0".repeat(64));
            }
            assertEquals(before, measure(f, statements));
        }
    }

    /** Statements one reconcile of a single request prepares, counted through a wrapping DataSource. */
    private static long measure(ProductionFixture f, AtomicInteger statements) throws Exception {
        statements.set(0);
        javax.sql.DataSource counting = countingOver(f.pool(), statements);
        ProductionService svc = new ProductionService(counting, f.provider, f.plan, new TickProductionClock(counting), f.queue);
        assertInstanceOf(ProductionResult.Ok.class, svc.reconcileRequest(f.ctx(), f.requestId("l2")));
        return statements.get();
    }

    private static javax.sql.DataSource countingOver(javax.sql.DataSource inner, AtomicInteger n) {
        return (javax.sql.DataSource) java.lang.reflect.Proxy.newProxyInstance(ProductionReconcileTest.class.getClassLoader(),
                new Class<?>[] {javax.sql.DataSource.class}, (p, m, a) -> {
                    Object res;
                    try {
                        res = m.invoke(inner, a);
                    } catch (java.lang.reflect.InvocationTargetException e) {
                        throw e.getCause();
                    }
                    if (!"getConnection".equals(m.getName())) return res;
                    return java.lang.reflect.Proxy.newProxyInstance(ProductionReconcileTest.class.getClassLoader(),
                            new Class<?>[] {java.sql.Connection.class}, (cp, cm, ca) -> {
                                if (cm.getName().equals("prepareStatement")) n.incrementAndGet();
                                try {
                                    return cm.invoke(res, ca);
                                } catch (java.lang.reflect.InvocationTargetException e) {
                                    throw e.getCause();
                                }
                            });
                });
    }
}
