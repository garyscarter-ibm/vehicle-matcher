package gcsp.api.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.production.ProductionProviderPort.Answer;
import gcsp.api.production.ProductionProviderPort.Confirmation;
import gcsp.api.production.ProductionProviderPort.Status;
import gcsp.api.production.SyntheticProductionProvider.ScriptResult;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/** Competing callers, scripted provider answers, and a provider that had already answered more at settle time. */
class ProductionConcurrencyAndScriptTest {

    private static List<ProductionResult> race(List<Callable<ProductionResult>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        try {
            List<Future<ProductionResult>> fs = new ArrayList<>();
            for (Callable<ProductionResult> c : calls) fs.add(pool.submit(c));
            List<ProductionResult> out = new ArrayList<>();
            for (Future<ProductionResult> f : fs) out.add(f.get());
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void twoThreadsWithTheSameCommandMakeOneSubmissionAndOneOrderPerLine() throws Exception {
        for (int round = 0; round < 3; round++) {
            try (ProductionFixture f = ProductionFixture.create()) {
                List<ProductionResult> rs = race(List.of(() -> f.submit("cmd-1"), () -> f.submit("cmd-1")));
                for (ProductionResult r : rs) assertFalse(r instanceof ProductionResult.Conflict, "got " + r);
                assertEquals(1, f.count("SELECT count(*) FROM production_submissions"));
                assertEquals(2, f.count("SELECT count(*) FROM production_requests"));
                assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
                assertEquals("requested", f.stateOf("l1"));
                assertEquals("requested", f.stateOf("l2"));
                assertEquals(2, f.count("SELECT count(*) FROM production_responses"));
            }
        }
    }

    @Test
    void twoCommandsForTheSamePlanLetOneThroughAndRefuseTheOther() throws Exception {
        for (int round = 0; round < 3; round++) {
            try (ProductionFixture f = ProductionFixture.create()) {
                List<ProductionResult> rs = race(List.of(() -> f.submit("cmd-a"), () -> f.submit("cmd-b")));
                long ok = rs.stream().filter(r -> r instanceof ProductionResult.Ok).count();
                long refused = rs.stream().filter(r -> r instanceof ProductionResult.Conflict c
                        && "plan-already-submitted".equals(c.code())).count();
                assertEquals(1, ok, rs.toString());
                assertEquals(1, refused, rs.toString());
                assertEquals(1, f.count("SELECT count(*) FROM production_submissions"));
                assertEquals(2, f.count("SELECT count(*) FROM production_synthetic_orders"));
            }
        }
    }

    @Test
    void scriptValidatesAndAppendsResponsesThatFoldIntoOneCumulativeAnswer() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("cmd-1");
            String op = f.requestId("l1");
            Instant now = ProductionFixture.T0.plusSeconds(3600);
            SyntheticProductionProvider s = f.synthetic;
            ScriptResult over = s.script(f.ctx(), op, "confirm", 6, null, null, now);
            assertFalse(over.ok());
            assertEquals("quantity-exceeds-request", over.code());
            assertEquals("delay-not-in-future", s.script(f.ctx(), op, "delay", null, now, "Plant stop", now).code());
            assertEquals("delay-reason-required", s.script(f.ctx(), op, "delay", null, now.plusSeconds(60), " ", now).code());
            assertEquals("operation-not-found", s.script(f.ctx(), "request-none", "confirm", 1, null, null, now).code());
            assertEquals("unknown-action", s.script(f.ctx(), op, "ship", 1, null, null, now).code());
            assertEquals(0, f.count("SELECT count(*) FROM production_synthetic_responses"));

            assertTrue(s.script(f.ctx(), op, "delay", null, now.plusSeconds(86400), "Plant stop", now).ok());
            ProductionProviderPort.Operation operation = ProductionStore.operation(f.ctx(), rowOf(f, op));
            Answer delayed = s.reconcile(operation);
            assertEquals(Status.DELAYED, delayed.status());
            assertEquals("Plant stop", delayed.reason());

            ScriptResult first = s.script(f.ctx(), op, "confirm", 2, null, null, now);
            assertTrue(first.ok());
            assertEquals(2, first.seq());
            Answer partly = s.reconcile(operation);
            assertEquals(Status.CONFIRMED, partly.status());
            assertEquals(1, partly.confirmations().size());
            assertTrue(partly.confirmations().get(0).supplyId().matches("supply-[0-9a-f]{32}"));
            assertEquals(now, partly.confirmations().get(0).confirmedAt());
            assertEquals(null, partly.delayUntil());

            assertEquals("refuse-after-confirmation", s.script(f.ctx(), op, "refuse", null, null, "No", now).code());
            assertEquals("quantity-exceeds-request", s.script(f.ctx(), op, "confirm", 4, null, null, now).code());
            assertTrue(s.script(f.ctx(), op, "confirm", 3, null, null, now).ok());
            assertEquals(2, s.reconcile(operation).confirmations().size());
            assertEquals(Status.NOT_FOUND, s.reconcile(new ProductionProviderPort.Operation(ProductionFixture.ENV, "run-1",
                    "request-none", "i5 Touring", "eDrive40", 1, ProductionFixture.T0, "0".repeat(64))).status());

            String other = f.requestId("l2");
            assertTrue(s.script(f.ctx(), other, "refuse", null, null, "Out of capacity", now).ok());
            assertEquals(Status.REFUSED, s.reconcile(ProductionStore.operation(f.ctx(), rowOf(f, other))).status());
            assertEquals("request-refused", s.script(f.ctx(), other, "confirm", 1, null, null, now).code());
        }
    }

    private static ProductionStore.RequestRow rowOf(ProductionFixture f, String requestId) throws Exception {
        try (var c = f.pool().getConnection()) {
            String sub = f.text("SELECT submission_id FROM production_requests WHERE request_id = ?", requestId);
            return ProductionStore.requests(c, f.ctx(), sub).stream().filter(r -> r.requestId().equals(requestId)).findFirst().orElseThrow();
        }
    }

    @Test
    void aProviderThatAlreadyConfirmedAndDelayedIsAppliedAtSettleTime() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            Instant at = ProductionFixture.T0.plusSeconds(60);
            f.use(new ProductionFixture.Scripted(op -> op.quantity() == 5
                    ? new Answer(Status.CONFIRMED, op.operationId(), "ref-" + op.operationId(),
                            List.of(new Confirmation("supply-aaa", 2, at), new Confirmation("supply-bbb", 3, at)), null, null, null, "v9", true)
                    : new Answer(Status.DELAYED, op.operationId(), "ref-" + op.operationId(),
                            List.of(new Confirmation("supply-ccc", 1, at)), at.plusSeconds(86400), "Plant stop", null, "v9", true)));
            ProductionResult.Ok ok = assertInstanceOf(ProductionResult.Ok.class, f.submit("cmd-1"));
            assertEquals("confirmed", f.stateOf("l1"));
            assertEquals("delayed", f.stateOf("l2"));
            assertEquals(5, f.count("SELECT confirmed_quantity FROM production_requests WHERE line_id = 'l1'"));
            assertEquals(1, f.count("SELECT confirmed_quantity FROM production_requests WHERE line_id = 'l2'"));
            assertEquals(3, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(3, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NULL"));
            assertEquals("Plant stop", ProductionFixture.first(ok.value().get("requests"), "l2", "reason").orElseThrow());
            assertEquals(2, f.count("SELECT count(*) FROM production_responses"));
        }
    }

    @Test
    void anAnswerThatConfirmsMoreThanWasRequestedIsTreatedAsUnknown() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            Instant at = ProductionFixture.T0.plusSeconds(60);
            f.use(new ProductionFixture.Scripted(op -> new Answer(Status.CONFIRMED, op.operationId(), "ref-" + op.operationId(),
                    List.of(new Confirmation("supply-" + op.quantity(), op.quantity() + 1, at)), null, null, null, "v9", true)));
            assertInstanceOf(ProductionResult.Pending.class, f.submit("cmd-1"));
            assertEquals("uncertain", f.stateOf("l1"));
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(0, f.count("SELECT count(*) FROM production_responses"));
        }
    }
}
