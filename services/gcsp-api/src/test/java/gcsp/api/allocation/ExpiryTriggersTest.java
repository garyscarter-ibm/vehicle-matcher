package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ExpiryTriggersTest {

    static final String T0_ISO = "2026-11-14T09:00:00.000Z";

    AllocationFixture f;
    ScriptedCandidates candidates;
    PolicyService policy;
    AllocationService service;
    AllocationTriggers triggers;
    BuddyExpiry expiry;

    @BeforeEach
    void setUp() throws Exception {
        f = AllocationFixture.create();
        candidates = new ScriptedCandidates();
        policy = new PolicyService(new RetainedFilePolicySource());
        service = new AllocationService(f.pool(), policy, candidates);
        triggers = new AllocationTriggers(f.pool(), service);
        expiry = new BuddyExpiry(f.pool(), policy);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    ExpiryResult.Done expire(AllocationScope scope) {
        return assertInstanceOf(ExpiryResult.Done.class, expiry.expire(scope));
    }

    TriggerResult.Consumed consume(AllocationScope scope, int max) {
        return assertInstanceOf(TriggerResult.Consumed.class, triggers.consume(scope, max));
    }

    String cursor() throws Exception {
        return f.text("SELECT last_revision || '|' || last_event_id FROM allocation_trigger_cursor");
    }

    static AllocationScope at(Instant now, long clockVersion) {
        return new AllocationScope(AllocationFixture.ENV, AllocationFixture.RUN, AllocationFixture.POLICY, now, clockVersion);
    }

    @Test
    void theDeadlineIsInclusiveAndLapsesChangeHoldOfferAndCarByVersion() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-01-01");
        f.buddyHold("h-1", "car-1", "e-a", 1, "2026-11-14T09:00:00Z");
        f.buddyHold("h-2", "car-2", "e-b", 1, "2026-11-14T09:00:01Z");

        ExpiryResult.Done done = expire(AllocationFixture.scope());
        assertEquals(List.of("h-1"), done.expired().stream().map(ExpiryResult.Lapse::holdId).toList());
        assertEquals(List.of(), done.retained());
        assertEquals("expired", f.text("SELECT state FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals("buddy-expired", f.text("SELECT attributes->>'releaseReason' FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals(T0_ISO, f.text("SELECT attributes->>'expiredAt' FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals("2", f.text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals("expired", f.text("SELECT state FROM buddy_offers WHERE hold_id = 'h-1'"));
        assertEquals("2", f.text("SELECT version::text FROM buddy_offers WHERE hold_id = 'h-1'"));
        assertEquals("released|2", f.text("SELECT state || '|' || version FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals("active", f.text("SELECT state FROM custody_holds WHERE hold_id = 'h-2'"));
        assertEquals("active", f.text("SELECT state FROM buddy_offers WHERE hold_id = 'h-2'"));
        assertEquals("released|1", f.text("SELECT state || '|' || version FROM stock_cars WHERE order_uuid = 'car-2'"));

        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired'"));
        JsonNode payload = AllocationFixture.json(f.text("SELECT payload::text FROM outbox_events "
                + "WHERE event_id = 'buddy-expired:h-1'"));
        assertEquals(AllocationFixture.json("{\"holdId\":\"h-1\",\"offerId\":\"o-h-1\",\"orderUuid\":\"car-1\","
                + "\"employeeId\":\"e-a\",\"expiresAt\":\"" + T0_ISO + "\",\"expiredAt\":\"" + T0_ISO + "\","
                + "\"policyVersion\":\"gcsp-policy-v1\"}"), payload);
        assertEquals("buddy.expire", f.text("SELECT command_type FROM command_receipts WHERE actor_id = 'system:allocation'"));
    }

    @Test
    void theSameTickTwiceReplaysWithoutNewEvents() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.buddyHold("h-1", "car-1", "e-a", 1, "2026-11-14T08:59:59Z");
        ExpiryResult.Done first = expire(AllocationFixture.scope());
        long revision = f.count("SELECT revision FROM runs");
        long receipts = f.count("SELECT count(*) FROM command_receipts");

        ExpiryResult.Done second = expire(AllocationFixture.scope());
        assertTrue(second.replayed());
        assertEquals(first.expired(), second.expired());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired'"));
        assertEquals("2", f.text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals(revision, f.count("SELECT revision FROM runs"));
        assertEquals(receipts, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void holdsOwnedElsewhereOrUncertainAreRetainedAndKeepTheirOccupancy() throws Exception {
        for (String n : List.of("1", "2", "3", "4")) f.car("car-" + n);
        for (String e : List.of("e-a", "e-b", "e-c", "e-d")) f.employee(e, "2027-01-01");
        f.buddyHold("h-op", "car-1", "e-a", 1, "2026-11-14T08:00:00Z");
        f.buddyHold("h-pending", "car-2", "e-b", 1, "2026-11-14T08:00:00Z");
        f.buddyHold("h-stock", "car-3", "e-c", 1, "2026-11-14T08:00:00Z");
        f.buddyHold("h-other", "car-4", "e-d", 1, "2026-11-14T08:00:00Z");
        f.update("INSERT INTO pending_operations (environment_id, run_id, operation_id, operation_type, idempotency_key, "
                + "input_digest, state) VALUES (?, ?, 'op-1', 'buddy-claim', 'k-1', ?, 'pending')", AllocationFixture.ENV,
                AllocationFixture.RUN, AllocationFixture.digest("op-1"));
        f.update("INSERT INTO buddy_operations (environment_id, run_id, operation_id, operation_type, hold_id, payload) "
                + "VALUES (?, ?, 'op-1', 'buddy-claim', 'h-op', '{}'::jsonb)", AllocationFixture.ENV, AllocationFixture.RUN);
        f.update("UPDATE buddy_offers SET state = 'decision-pending' WHERE hold_id = 'h-pending'");
        f.update("UPDATE stock_cars SET state = 'held' WHERE order_uuid = 'car-3'");
        f.hold("h-allocated", "car-4", "e-a", 1, "allocated");
        f.update("UPDATE custody_holds SET slot_unit = 2 WHERE hold_id = 'h-allocated'");

        ExpiryResult.Done done = expire(AllocationFixture.scope());
        assertEquals(List.of(), done.expired());
        assertEquals(List.of("h-op:authority-reconciliation-required", "h-other:stock-reconciliation-required",
                "h-pending:authority-reconciliation-required", "h-stock:stock-reconciliation-required"),
                done.retained().stream().map(r -> r.holdId() + ":" + r.reason()).sorted().toList());
        assertEquals(4, f.count("SELECT count(*) FROM custody_holds WHERE state = 'active' AND hold_type = 'buddy-offer'"));
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events"));
        assertEquals(0, f.count("SELECT revision FROM runs"));
        assertEquals(0, f.count("SELECT count(*) FROM stock_cars WHERE version <> 1"));
        assertEquals("decision-pending", f.text("SELECT state FROM buddy_offers WHERE hold_id = 'h-pending'"));
    }

    @Test
    void anUnreadableDeadlinePolicyRefusesTheWholeTickAndWritesNothing() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.buddyHold("h-1", "car-1", "e-a", 1, "2026-11-14T08:00:00Z");
        f.update("UPDATE custody_holds SET attributes = jsonb_set(attributes, '{policyVersion}', '\"gcsp-policy-v0\"')");
        ExpiryResult.Refused refused = assertInstanceOf(ExpiryResult.Refused.class, expiry.expire(AllocationFixture.scope()));
        assertEquals("policy-unavailable", refused.code());
        assertEquals("active", f.text("SELECT state FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void lapsedCarsGoToOtherEmployeesAndTwoLapsesInOneTickMakeOneGroupedTrigger() throws Exception {
        for (String n : List.of("1", "2")) f.car("car-" + n);
        for (String e : List.of("e-a", "e-b", "e-c", "e-d")) f.employee(e, "2027-0" + (e.charAt(2) - 'a' + 1) + "-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50).eligible("e-b", "car-1", 80)
                .eligible("e-b", "car-2", 70).eligible("e-c", "car-1", 90).eligible("e-c", "car-2", 50)
                .eligible("e-d", "car-1", 80).eligible("e-d", "car-2", 70);
        f.emit("stock-released", "rel-1", "{\"kind\":\"stock-released\"}");

        TriggerResult.Consumed first = consume(AllocationFixture.scope(), 10);
        assertEquals(1, first.allocations().size());
        assertEquals("stock-released", first.allocations().get(0).triggerType());
        assertEquals(List.of("e-a:car-1", "e-b:car-2"), f.occupying());

        Instant due = Instant.parse(f.text("SELECT to_char(min(expires_at) AT TIME ZONE 'UTC', "
                + "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM custody_holds WHERE state = 'active'"));
        AllocationScope tick = at(due, 2);
        ExpiryResult.Done done = expire(tick);
        assertEquals(2, done.expired().size());
        assertEquals(List.of(), f.occupying());
        assertEquals(1, f.count("SELECT count(DISTINCT run_revision) FROM outbox_events WHERE event_type = 'buddy-expired'"));

        TriggerResult.Consumed second = consume(tick, 10);
        assertEquals(1, second.allocations().size());
        assertEquals("buddy-expired", second.allocations().get(0).triggerType());
        assertEquals("allocated", second.allocations().get(0).state());
        assertEquals(List.of("e-c:car-1", "e-d:car-2"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM allocation_runs WHERE trigger_type = 'buddy-expired'"));
        List<String> lapsedHolds = f.column("SELECT hold_id FROM custody_holds WHERE employee_id IN ('e-a', 'e-b') "
                + "ORDER BY hold_id");
        assertEquals(lapsedHolds, f.column("SELECT jsonb_array_elements_text(plan->'trigger'->'holdIds') FROM allocation_runs "
                + "WHERE trigger_type = 'buddy-expired'"));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds WHERE employee_id IN ('e-a', 'e-b') AND state <> 'expired'"));
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds WHERE employee_id IN ('e-a', 'e-b')"));
        assertEquals(0, f.count("SELECT count(*) FROM allocation_evaluations e JOIN allocation_runs r USING (allocation_id) "
                + "WHERE r.trigger_type = 'buddy-expired' AND e.employee_id IN ('e-a', 'e-b')"));
    }

    @Test
    void consumingTwiceAllocatesNothingNewAndAPendingTriggerKeepsTheCursorBeforeIt() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        f.employee("e-c", "2027-03-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-b", "car-2", 80).eligible("e-c", "car-3", 70);
        f.emit("stock-released", "rel-1", "{}");
        TriggerResult.Consumed first = consume(AllocationFixture.scope(), 10);
        assertEquals(1, first.allocations().size());
        String afterFirst = cursor();
        TriggerResult.Consumed again = consume(AllocationFixture.scope(), 10);
        assertEquals(List.of(), again.allocations());
        assertEquals(afterFirst, cursor());
        assertEquals(1, f.count("SELECT count(*) FROM allocation_runs"));
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds"));

        f.car("car-3");
        f.emit("stock-released", "rel-2", "{}");
        AtomicBoolean down = new AtomicBoolean();
        DataSource flaky = new DownableSource(f.pool(), down);
        AllocationTriggers pending = new AllocationTriggers(f.pool(), new AllocationService(flaky, policy, candidates));
        candidates.hook = r -> down.set(true);
        TriggerResult result = pending.consume(AllocationFixture.scope(), 10);
        assertEquals("database-unavailable", assertInstanceOf(TriggerResult.Pending.class, result).code());
        assertEquals(afterFirst, cursor());
        assertEquals(List.of("e-a:car-1", "e-b:car-2"), f.occupying());

        down.set(false);
        candidates.hook = r -> {};
        TriggerResult.Consumed resumed = assertInstanceOf(TriggerResult.Consumed.class,
                pending.consume(AllocationFixture.scope(), 10));
        assertEquals(1, resumed.allocations().size());
        assertEquals(List.of("e-a:car-1", "e-b:car-2", "e-c:car-3"), f.occupying());
        assertEquals(2, f.count("SELECT count(*) FROM allocation_runs"));
        assertTrue(cursor().endsWith("|rel-2"));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE employee_id = 'e-c'"));
    }

    @Test
    void aMalformedTriggerEventStopsConsumptionBeforeIt() throws Exception {
        f.car("car-1");
        f.emit("buddy-expired", "bad-1", "{\"holdId\":\"h-x\"}");
        TriggerResult.Refused refused = assertInstanceOf(TriggerResult.Refused.class,
                triggers.consume(AllocationFixture.scope(), 5));
        assertEquals("allocation-trigger-invalid", refused.code());
        assertEquals("0|", cursor());
        assertEquals(0, f.count("SELECT count(*) FROM allocation_runs"));
    }

    @Test
    void maxTriggersLimitsThePass() throws Exception {
        f.car("car-1");
        for (String id : List.of("rel-1", "rel-2", "rel-3")) f.emit("stock-released", id, "{}");
        assertEquals(2, consume(AllocationFixture.scope(), 2).allocations().size());
        assertTrue(cursor().endsWith("|rel-2"));
        assertEquals(1, consume(AllocationFixture.scope(), 2).allocations().size());
        assertTrue(cursor().endsWith("|rel-3"));
    }

    @Test
    void twoConsumersOnOneRunAllocateEachTriggerOnce() throws Exception {
        for (String n : List.of("1", "2", "3")) f.car("car-" + n);
        for (String e : List.of("e-a", "e-b", "e-c")) {
            f.employee(e, "2027-01-01");
            for (String n : List.of("1", "2", "3")) candidates.eligible(e, "car-" + n, 50 + n.charAt(0));
        }
        for (String id : List.of("rel-1", "rel-2", "rel-3")) f.emit("stock-released", id, "{}");
        AllocationTriggers other = new AllocationTriggers(f.pool(), new AllocationService(f.pool(), policy, candidates));
        List<Object> results = parallel(() -> triggers.consume(AllocationFixture.scope(), 10),
                () -> other.consume(AllocationFixture.scope(), 10));
        results.forEach(r -> assertInstanceOf(TriggerResult.Consumed.class, r));

        assertEquals(3, f.count("SELECT count(*) FROM allocation_runs WHERE state = 'completed'"));
        assertTrue(cursor().endsWith("|rel-3"));
        assertEquals(3, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(3, f.count("SELECT count(DISTINCT order_uuid) FROM custody_holds"));
        assertEquals(3, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(1, f.count("SELECT count(*) FROM allocation_trigger_cursor"));
    }

    @Test
    void expiryAndAClaimForAnotherCarBothLand() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-old", "2027-01-01");
        f.employee("e-new", "2027-01-01");
        f.buddyHold("h-old", "car-1", "e-old", 1, "2026-11-14T08:00:00Z");
        candidates.eligible("e-new", "car-2", 90);
        CountDownLatch claimInFlight = new CountDownLatch(1);
        CountDownLatch expiryDone = new CountDownLatch(1);
        candidates.hook = r -> {
            claimInFlight.countDown();
            try {
                expiryDone.await(30, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        ExecutorService pool = Executors.newFixedThreadPool(1);
        try {
            Future<AllocationResult> allocating = pool.submit(
                    () -> service.allocate(AllocationFixture.scope(), AllocationTest.released("rel-1")));
            assertTrue(claimInFlight.await(30, TimeUnit.SECONDS));
            expire(AllocationFixture.scope());
            expiryDone.countDown();
            assertInstanceOf(AllocationResult.Completed.class, allocating.get(60, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
        assertEquals("expired", f.text("SELECT state FROM custody_holds WHERE hold_id = 'h-old'"));
        assertEquals("expired", f.text("SELECT state FROM buddy_offers WHERE hold_id = 'h-old'"));
        assertEquals(List.of("e-new:car-2"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
    }

    @Test
    void anOfferDeclinedEventSitsTheDeclinerOutAndKeepsTheDeclinedCarExcluded() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-c", "2027-02-01");
        f.declinedOffer("e-a", "car-1", 1);
        candidates.eligible("e-a", "car-1", 99);
        f.emit("offer-declined", "declined-1",
                "{\"holdId\":\"h-e-a-car-1\",\"orderUuid\":\"car-1\",\"employeeId\":\"e-a\"}");

        TriggerResult.Consumed first = consume(AllocationFixture.scope(), 10);
        assertEquals("offer-declined", first.allocations().get(0).triggerType());
        assertEquals("no-assignment", first.allocations().get(0).state());
        assertEquals(List.of("e-c"), f.column("SELECT employee_id FROM allocation_evaluations"));
        assertEquals(List.of(), f.occupying());

        candidates.eligible("e-c", "car-1", 10);
        f.emit("stock-released", "rel-2", "{}");
        TriggerResult.Consumed second = consume(AllocationFixture.scope(), 10);
        assertEquals("allocated", second.allocations().get(0).state());
        assertEquals(List.of("e-c:car-1"), f.occupying());
        assertTrue(f.text("SELECT evaluation::text FROM allocation_evaluations WHERE employee_id = 'e-a' "
                + "AND allocation_id = ?", second.allocations().get(0).allocationId()).contains("declined-unchanged"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
    }

    @SafeVarargs
    private static List<Object> parallel(Callable<Object>... work) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(work.length);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Object>> futures = new ArrayList<>();
            for (Callable<Object> w : work) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return w.call();
                }));
            }
            start.countDown();
            List<Object> out = new ArrayList<>();
            for (Future<Object> future : futures) out.add(future.get(90, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    /** A data source that refuses new connections while {@code down} is set. */
    private record DownableSource(DataSource delegate, AtomicBoolean down) implements DataSource {
        @Override
        public java.sql.Connection getConnection() throws java.sql.SQLException {
            if (down.get()) throw new java.sql.SQLException("database down", "08001");
            return delegate.getConnection();
        }

        @Override
        public java.sql.Connection getConnection(String u, String p) throws java.sql.SQLException {
            return getConnection();
        }

        @Override
        public java.io.PrintWriter getLogWriter() {
            return null;
        }

        @Override
        public void setLogWriter(java.io.PrintWriter out) {}

        @Override
        public void setLoginTimeout(int seconds) {}

        @Override
        public int getLoginTimeout() {
            return 0;
        }

        @Override
        public java.util.logging.Logger getParentLogger() {
            return java.util.logging.Logger.getGlobal();
        }

        @Override
        public <T> T unwrap(Class<T> iface) throws java.sql.SQLException {
            throw new java.sql.SQLException("not a wrapper");
        }

        @Override
        public boolean isWrapperFor(Class<?> iface) {
            return false;
        }
    }
}
