package gcsp.api.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.supply.PolicyReading;
import gcsp.api.supply.ProviderResponse;
import gcsp.api.supply.PullRequest;
import gcsp.api.supply.ReleasePolicy;
import gcsp.api.supply.StockRelease;
import gcsp.api.supply.SupplyProvider;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** A confirmed request has its original tracking date even while the release queue is unavailable. */
class ProductionConfirmationDateTest {

    private static final Instant AT = ProductionFixture.T0.plusSeconds(3600);

    @Test
    void newConfirmationHasPolicyDateBeforeQueueSucceeds() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("date-request");
            f.advance(AT);
            f.queue.delegate = (scope, command, now, supply, confirmed, version) ->
                    new SupplyQueuePort.Unavailable("queue-down", "Queue unavailable");
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 2, null, null, AT).ok());

            assertInstanceOf(ProductionResult.Ok.class, f.service.reconcileRequest(f.ctx(), f.requestId("l1")));

            JsonNode row = request(f, f.requestId("l1"));
            assertEquals("partly-confirmed", row.path("state").asText());
            assertEquals(AT.plusSeconds(3 * 86400).toString(), row.path("supplies").get(0).path("eligibleFrom").asText());
            assertEquals(0, f.count("SELECT count(*) FROM confirmed_supply_queue"));
            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations WHERE queued_at IS NOT NULL"));
        }
    }

    @Test
    void delayedReconciliationUsesEachOriginalConfirmationClockAndPolicy() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("historical-date");
            Instant second = AT.plusSeconds(86400);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, AT).ok());
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, second).ok());
            f.advance(second.plusSeconds(86400));
            List<Instant> reads = new ArrayList<>();
            f.service = service(f, (run, at) -> {
                assertEquals("run-1", run);
                reads.add(at);
                return new PolicyReading.Ok("policy-" + at, 10, at.equals(AT) ? 3 : 5, 60);
            });
            unavailableQueue(f);

            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

            JsonNode supplies = request(f, f.requestId("l1")).path("supplies");
            assertEquals(2, supplies.size());
            for (JsonNode supply : supplies) {
                Instant confirmed = Instant.parse(supply.path("confirmedAt").asText());
                assertEquals(confirmed.plusSeconds((confirmed.equals(AT) ? 3 : 5) * 86400).toString(),
                        supply.path("eligibleFrom").asText());
            }
            assertEquals(List.of(AT, second), reads);
        }
    }

    @Test
    void unavailableOrInvalidPolicyRollsBackAnswerAndSameCommandCanRetry() throws Exception {
        for (PolicyReading invalid : java.util.Arrays.asList(new PolicyReading.Unavailable("missing policy"),
                new PolicyReading.Ok("p", 10, -1, 60), new PolicyReading.Ok("", 10, 3, 60),
                new PolicyReading.Ok("p", 10, Integer.MAX_VALUE, 60), null)) {
            try (ProductionFixture f = ProductionFixture.create()) {
                f.submit("policy-refusal");
                f.advance(AT);
                assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 2, null, null, AT).ok());
                AtomicReference<PolicyReading> policy = new AtomicReference<>(invalid);
                f.service = service(f, (run, at) -> {
                    if (policy.get() == null) throw new IllegalStateException("policy source unavailable");
                    return policy.get();
                });
                unavailableQueue(f);
                List<Long> before = f.footprint();
                long version = f.count("SELECT version FROM production_requests WHERE line_id = 'l1'");

                f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

                assertEquals(before, f.footprint(), "policy refusal leaves no response, confirmation, receipt or revision");
                assertEquals(version, f.count("SELECT version FROM production_requests WHERE line_id = 'l1'"));
                policy.set(new PolicyReading.Ok("p-restored", 10, 3, 60));
                f.service.reconcileRequest(f.ctx(), f.requestId("l1"));
                assertEquals(1, f.count("SELECT count(*) FROM production_confirmations"));
                assertEquals(AT.plusSeconds(3 * 86400).toString(),
                        request(f, f.requestId("l1")).path("supplies").get(0).path("eligibleFrom").asText());
            }
        }
    }

    @Test
    void newConfirmationsAtOneClockResolvePolicyOnlyOnce() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("same-clock");
            f.advance(AT);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, AT).ok());
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, AT).ok());
            AtomicInteger reads = new AtomicInteger();
            f.service = service(f, (run, at) -> {
                reads.incrementAndGet();
                assertEquals(AT, at);
                return new PolicyReading.Ok("p", 10, 3, 60);
            });
            unavailableQueue(f);

            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

            assertEquals(2, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(1, reads.get());
        }
    }

    @Test
    void invalidProviderAnswerDoesNotResolvePolicy() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("invalid-answer");
            f.advance(AT);
            f.provider = new ProductionFixture.Scripted(op -> new ProductionProviderPort.Answer(
                    ProductionProviderPort.Status.CONFIRMED, "wrong-operation", "provider-ref",
                    List.of(new ProductionProviderPort.Confirmation("supply-invalid", 1, AT)),
                    null, null, null, "source-v1", true));
            f.service = service(f, (run, at) -> { throw new AssertionError("invalid answers must not resolve policy"); });

            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

            assertEquals(0, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals("requested", f.stateOf("l1"));
        }
    }

    @Test
    void unavailableSecondHistoricalPolicyRollsBackEarlierConfirmationToo() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("atomic-cumulative");
            Instant second = AT.plusSeconds(86400);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, AT).ok());
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, second).ok());
            f.advance(second);
            f.service = service(f, (run, at) -> at.equals(AT) ? new PolicyReading.Ok("p", 10, 3, 60)
                    : new PolicyReading.Unavailable("historical policy unavailable"));
            List<Long> before = f.footprint();

            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

            assertEquals(before, f.footprint());
            assertEquals("requested", f.stateOf("l1"));
        }
    }

    @Test
    void unchangedAndReplayedAnswersDoNotResolvePolicyOrBackfillOldNullDates() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("date-replay");
            f.advance(AT);
            AtomicInteger reads = new AtomicInteger();
            f.service = service(f, (run, at) -> {
                if (reads.incrementAndGet() > 1) throw new AssertionError("replay must not resolve policy");
                return new PolicyReading.Ok("p", 10, 3, 60);
            });
            unavailableQueue(f);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 2, null, null, AT).ok());
            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));
            long responses = f.count("SELECT count(*) FROM production_responses");
            f.update("UPDATE production_confirmations SET eligible_from = NULL");

            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));
            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));

            assertEquals(1, reads.get());
            assertEquals(responses, f.count("SELECT count(*) FROM production_responses"));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations WHERE eligible_from IS NULL"));
            assertTrue(request(f, f.requestId("l1")).path("supplies").get(0).path("eligibleFrom").isNull());

            Instant later = AT.plusSeconds(86400);
            f.advance(later);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 1, null, null, later).ok());
            f.service = service(f, (run, at) -> {
                assertEquals(later, at, "only the newly inserted confirmation resolves policy");
                return new PolicyReading.Ok("later-p", 10, 5, 60);
            });
            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));
            assertEquals(2, f.count("SELECT count(*) FROM production_confirmations"));
            assertEquals(1, f.count("SELECT count(*) FROM production_confirmations WHERE eligible_from IS NULL"));
            for (JsonNode supply : request(f, f.requestId("l1")).path("supplies")) {
                if (later.equals(Instant.parse(supply.path("confirmedAt").asText()))) {
                    assertEquals(later.plusSeconds(5 * 86400).toString(), supply.path("eligibleFrom").asText());
                } else {
                    assertTrue(supply.path("eligibleFrom").isNull());
                }
            }
        }
    }

    @Test
    void laterQueuePolicyAndImmutableQueueDateRemainAuthoritative() throws Exception {
        try (ProductionFixture f = ProductionFixture.create()) {
            f.submit("later-queue");
            f.advance(AT);
            unavailableQueue(f);
            assertTrue(f.synthetic.script(f.ctx(), f.requestId("l1"), "confirm", 2, null, null, AT).ok());
            f.service.reconcileRequest(f.ctx(), f.requestId("l1"));
            assertEquals(AT.plusSeconds(3 * 86400).toString(),
                    request(f, f.requestId("l1")).path("supplies").get(0).path("eligibleFrom").asText());
            f.advance(AT.plusSeconds(86400));
            AtomicInteger policyReads = new AtomicInteger();
            StockRelease release = new StockRelease(f.pool(), (run, at) -> {
                policyReads.incrementAndGet();
                assertEquals(AT.plusSeconds(86400), at);
                return new PolicyReading.Ok("later-policy", 10, 7, 60);
            }, new SupplyProvider() {
                public String mode() { return "never"; }
                public ProviderResponse pull(PullRequest request) { throw new AssertionError("not a stock pull"); }
            });
            f.queue.delegate = new StockReleaseSupplyQueue(release);

            assertInstanceOf(ProductionResult.Ok.class, f.service.queueRequest(f.ctx(), f.requestId("l1")));

            String queuedDate = AT.plusSeconds(7 * 86400).toString();
            assertEquals(queuedDate, request(f, f.requestId("l1")).path("supplies").get(0).path("eligibleFrom").asText());
            assertEquals("later-policy", f.text("SELECT policy_version FROM confirmed_supply_queue"));
            f.update("UPDATE production_confirmations SET eligible_from = ?", java.sql.Timestamp.from(AT));
            assertEquals(queuedDate, request(f, f.requestId("l1")).path("supplies").get(0).path("eligibleFrom").asText());
            f.service.queueRequest(f.ctx(), f.requestId("l1"));
            assertEquals(1, policyReads.get());
            assertEquals(1, f.count("SELECT count(*) FROM confirmed_supply_queue"));
        }
    }

    private static ProductionService service(ProductionFixture f, ReleasePolicy policy) throws Exception {
        return new ProductionService(f.pool(), f.provider, f.plan, new TickProductionClock(f.pool()), f.queue, policy);
    }

    private static void unavailableQueue(ProductionFixture f) {
        f.queue.delegate = (scope, command, now, supply, confirmed, version) ->
                new SupplyQueuePort.Unavailable("queue-down", "Queue unavailable");
    }

    private static JsonNode request(ProductionFixture f, String requestId) {
        JsonNode status = ProductionFixture.value(f.service.status(f.ctx()));
        for (JsonNode row : status.path("requests")) if (requestId.equals(row.path("requestId").asText())) return row;
        throw new AssertionError("missing request " + requestId);
    }
}
