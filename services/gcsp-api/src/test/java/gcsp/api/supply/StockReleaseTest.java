package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.supply.ReleaseResult.Status;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class StockReleaseTest {

    static final Instant T0 = SupplyFixture.T0;
    static final String CAR1 = "00000000-0000-4000-8000-000000000001";

    SupplyFixture f;
    RunContext ctx;
    Stubs.Policy policy;
    TranchePlanProvider plan;
    StockRelease release;

    @BeforeEach
    void setUp() throws Exception {
        f = SupplyFixture.create();
        ctx = f.ctx();
        policy = new Stubs.Policy(100, 1);
        plan = new TranchePlanProvider(SupplyFixture.plan());
        release = new StockRelease(f.pool(), policy, plan);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    ReleaseResult tick(String id, Instant now, long version) {
        return release.deliver(ctx, new TickEvent(id, now, version));
    }

    ReleaseResult tick(String id) {
        return tick(id, T0, 1);
    }

    /** The plan provider answering through a mutation of its raw value. */
    SupplyProvider mutating(Consumer<ObjectNode> edit) {
        return new Stubs.Provider(req -> {
            ProviderResponse.Ok ok = (ProviderResponse.Ok) plan.pull(req);
            ObjectNode value = ((ObjectNode) ok.value()).deepCopy();
            edit.accept(value);
            return new ProviderResponse.Ok(value);
        });
    }

    StockRelease with(SupplyProvider p) throws Exception {
        return new StockRelease(f.pool(), policy, p);
    }

    void seedUnreleased(String uuid, String number, long wholesaler, long revision) throws Exception {
        f.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, 'run-1', ?, 'VDVNSjpGS1NGVSxQMDMwMCxTMDMzNyxTMDNBQyxTMDQ4OA==', 'unreleased', "
                + "jsonb_build_object('orderNumber', ?::text, 'wholesalerOrderId', ?::bigint, "
                + "'corpusVersion', 'TEST-REFERENCE-ONLY', 'revision', ?::bigint))",
                SupplyFixture.ENV, uuid, number, wholesaler, revision);
    }

    String tickState(String id) throws Exception {
        return f.text("SELECT state FROM supply_release_ticks WHERE tick_id = ?", id);
    }

    long attempts(String id) throws Exception {
        return f.count("SELECT attempts FROM supply_release_ticks WHERE tick_id = ?", id);
    }

    // 1
    @Test
    void tickReleasesExactlyTheFivePlanCarsWithProvenance() throws Exception {
        ReleaseResult r = tick("t1");
        assertEquals(Status.OK, r.status());
        assertFalse(r.replayed());
        assertEquals("stock-released", r.value().get("kind").asText());
        assertEquals(5, r.value().get("orderUuids").size());
        assertEquals(5, f.cars("released"));
        assertEquals(1, f.releases());
        assertEquals("completed", tickState("t1"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'stock-released'"));
        assertTrue(f.revision() >= 2);
        JsonNode attrs = SupplyFixture.JSON.readTree(f.text(
                "SELECT attributes::text FROM stock_cars WHERE order_uuid = ?", CAR1));
        JsonNode rel = attrs.get("release");
        assertEquals("fucq92-small-test-v1:test-weekly-window:0", rel.get("trancheId").asText());
        assertEquals("test-weekly-window", rel.get("windowId").asText());
        assertTrue(rel.get("supplyId").isNull());
        assertEquals("2026-11-05T09:00:00.000Z", rel.get("releasedAt").asText());
        assertEquals("test-policy-v1", rel.get("policyVersion").asText());
        assertEquals("available", rel.get("availability").get("state").asText());
        assertEquals(rel.get("trancheId").asText(), rel.get("availability").get("version").asText());
        assertEquals("0000001", attrs.get("orderNumber").asText());
        assertFalse(attrs.toString().toLowerCase().contains("vin"));
        List<ReleasedCar> page = new ReleasedStock(f.pool()).page(ctx, null, 10);
        assertEquals(5, page.size());
        assertTrue(page.stream().noneMatch(ReleasedCar::occupied));
        assertEquals(CAR1, page.get(0).orderUuid());
        ReleaseReceipt latest = new ReleasedStock(f.pool()).latest(ctx).orElseThrow();
        assertEquals(rel.get("trancheId").asText(), latest.trancheId());
        assertEquals("t1", latest.tickId());
    }

    // 2
    @Test
    void replayChangedInputAndSecondTickAtSameClock() throws Exception {
        ReleaseResult first = tick("t1");
        long revision = f.revision();
        ReleaseResult again = tick("t1");
        assertEquals(Status.OK, again.status());
        assertTrue(again.replayed());
        assertEquals(first.value(), again.value());
        assertEquals(revision, f.revision());
        assertEquals(5, f.cars("released"));

        ReleaseResult other = tick("t2");
        assertEquals(Status.OK, other.status());
        assertEquals("no-release", other.value().get("kind").asText());
        assertEquals(5, f.cars("released"));
        assertEquals(1, f.releases());

        ReleaseResult changedNow = tick("t1", T0.plusSeconds(60), 1);
        assertEquals(Status.CONFLICT, changedNow.status());
        assertEquals("tick-input-changed", changedNow.code());
        ReleaseResult changedVersion = tick("t1", T0, 2);
        assertEquals("tick-input-changed", changedVersion.code());
    }

    // 3
    @Test
    void releaseSizeSplitsTheWindow() throws Exception {
        policy.reading = new PolicyReading.Ok("test-policy-v1", 2, 1, 60);
        assertEquals(2, tick("a", T0, 1).value().get("orderUuids").size());
        assertEquals(2, tick("b", T0.plusSeconds(60), 2).value().get("orderUuids").size());
        assertEquals(4, f.cars("released"));
        assertEquals(2, f.releases());
        assertEquals(1, tick("c", T0.plusSeconds(120), 3).value().get("orderUuids").size());
        assertEquals(5, f.cars("released"));
        assertEquals(3, f.releases());
    }

    // 4
    @Test
    void seededUnreleasedCarIsPromotedByCas() throws Exception {
        seedUnreleased(CAR1, "0000001", 10000001, 1);
        f.update("UPDATE stock_cars SET attributes = attributes || '{\"facts\":{\"seeded\":true}}' WHERE order_uuid = ?",
                CAR1);
        ReleaseResult r = tick("t1");
        assertEquals(Status.OK, r.status());
        assertEquals(5, f.cars("released"));
        assertEquals("true", f.text("SELECT attributes->'facts'->>'seeded' FROM stock_cars WHERE order_uuid = ?", CAR1));
        assertEquals(2, f.count("SELECT version FROM stock_cars WHERE order_uuid = ?", CAR1));
        JsonNode attrs = SupplyFixture.JSON.readTree(f.text(
                "SELECT attributes::text FROM stock_cars WHERE order_uuid = ?", CAR1));
        assertTrue(attrs.has("release"));
        assertEquals("0000001", attrs.get("orderNumber").asText());
        assertEquals("test-weekly-window", attrs.get("release").get("windowId").asText());
    }

    @Test
    void changedIdentityConflictsWithNoPartialRelease() throws Exception {
        seedUnreleased(CAR1, "0000001", 10000001, 2);
        ReleaseResult r = tick("t1");
        assertEquals(Status.CONFLICT, r.status());
        assertEquals("stock-identity-changed", r.code());
        assertEquals(0, f.cars("released"));
        assertEquals(0, f.releases());
        assertEquals("refused", tickState("t1"));
        ReleaseResult replay = tick("t1");
        assertEquals("stock-identity-changed", replay.code());
        assertTrue(replay.replayed());
    }

    @Test
    void occupiedUnreleasedCarConflicts() throws Exception {
        seedUnreleased(CAR1, "0000001", 10000001, 1);
        f.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, 'run-1', 'e1')",
                SupplyFixture.ENV);
        f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, 'run-1', 's1', 'e1', 1)", SupplyFixture.ENV);
        f.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, "
                + "slot_unit, hold_type, state, expires_at) VALUES (?, 'run-1', 'h1', ?, 'e1', 's1', 1, 'cart', "
                + "'active', now() + interval '1 day')", SupplyFixture.ENV, CAR1);
        ReleaseResult r = tick("t1");
        assertEquals("unreleased-stock-occupied", r.code());
        assertEquals(0, f.cars("released"));
        assertEquals(1, f.cars("unreleased"));
    }

    // 5
    @Test
    void futureWindowReleasesNothing() throws Exception {
        ReleaseResult r = tick("early", T0.minusSeconds(3600), 1);
        assertEquals(Status.OK, r.status());
        assertEquals("no-release", r.value().get("kind").asText());
        assertEquals(0, f.cars("released"));
        assertEquals(0, f.releases());
    }

    // 6
    @Test
    void supplyTrancheWaitsForQueueAndLeadTime() throws Exception {
        plan = new TranchePlanProvider(SupplyFixture.plan(p -> {
            ((ObjectNode) p.get("windows").get(0)).put("supplyId", "confirmed-1");
            return p;
        }));
        release = new StockRelease(f.pool(), policy, plan);
        assertEquals("no-release", tick("t1", T0, 1).value().get("kind").asText());
        SupplyConfirmation conf = new SupplyConfirmation("confirmed-1", "confirmed", T0, "TEST-production-ack");
        assertEquals(Status.INVALID, release.queueConfirmedSupply(ctx, "bad", T0,
                new SupplyConfirmation("confirmed-1", "requested", T0, "v")).status());
        assertEquals(Status.INVALID, release.queueConfirmedSupply(ctx, "future", T0,
                new SupplyConfirmation("confirmed-1", "confirmed", T0.plusSeconds(60), "v")).status());
        ReleaseResult queued = release.queueConfirmedSupply(ctx, "q1", T0, conf);
        assertEquals(Status.OK, queued.status());
        assertEquals("2026-11-06T09:00:00.000Z", queued.value().get("eligibleFrom").asText());
        ReleaseResult replay = release.queueConfirmedSupply(ctx, "q1", T0, conf);
        assertTrue(replay.replayed());
        assertEquals(queued.value(), replay.value());
        ReleaseResult sameSupply = release.queueConfirmedSupply(ctx, "q2", T0.plusSeconds(5), conf);
        assertEquals(Status.OK, sameSupply.status());
        assertEquals(queued.value(), sameSupply.value());
        ReleaseResult changed = release.queueConfirmedSupply(ctx, "q3", T0,
                new SupplyConfirmation("confirmed-1", "confirmed", T0, "changed"));
        assertEquals("confirmation-input-changed", changed.code());
        assertEquals(1, f.count("SELECT count(*) FROM confirmed_supply_queue"));
        assertEquals("no-release", tick("t2", T0.plus(Duration.ofHours(12)), 2).value().get("kind").asText());
        assertEquals(0, f.cars("released"));
        ReleaseResult done = tick("t3", T0.plus(Duration.ofDays(1)), 3);
        assertEquals(5, done.value().get("orderUuids").size());
        assertEquals("confirmed-1", done.value().get("supplyId").asText());
    }

    @Test
    void engineRefusesAProviderTrancheOutsideTheQueue() throws Exception {
        SupplyProvider lying = mutating(v -> ((ObjectNode) v.get("tranche")).put("supplyId", "not-queued"));
        ReleaseResult r = with(lying).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.INVALID, r.status());
        assertEquals("supply-not-queued", r.code());
        assertEquals(0, f.cars("released"));
        policy.reading = new PolicyReading.Ok("test-policy-v1", 100, 1, 60);
        StockRelease queuer = with(lying);
        queuer.queueConfirmedSupply(ctx, "q", T0, new SupplyConfirmation("not-queued", "confirmed", T0, "v"));
        ReleaseResult early = queuer.deliver(ctx, new TickEvent("t2", T0.plusSeconds(60), 2));
        assertEquals("supply-before-lead-time", early.code());
        assertEquals(0, f.cars("released"));
    }

    // 7
    @Test
    void unavailableProviderLeavesTickPendingThenRedeliveryReleasesOnce() throws Exception {
        Stubs.Provider p = new Stubs.Provider(req -> new ProviderResponse.Unavailable("source-down", "down"));
        StockRelease sr = with(p);
        ReleaseResult r = sr.deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.UNAVAILABLE, r.status());
        assertEquals("source-down", r.code());
        assertTrue(r.retryable());
        assertEquals("pending", tickState("t1"));
        assertEquals(1, attempts("t1"));
        assertEquals(0, f.cars("released"));
        p.behaviour = plan::pull;
        ReleaseResult ok = sr.deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.OK, ok.status());
        assertEquals(5, f.cars("released"));
        assertEquals(1, f.releases());
        assertEquals("completed", tickState("t1"));
    }

    @Test
    void thrownProviderCountsAsUnavailable() throws Exception {
        Stubs.Provider p = new Stubs.Provider(req -> {
            throw new IllegalStateException("boom");
        });
        ReleaseResult r = with(p).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.UNAVAILABLE, r.status());
        assertEquals("pending", tickState("t1"));
    }

    @Test
    void staleSourceStaysPending() throws Exception {
        SupplyProvider stale = mutating(v -> v.put("observedAt", "2026-11-05T07:00:00.000Z"));
        ReleaseResult r = with(stale).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.UNAVAILABLE, r.status());
        assertEquals("stock-source-stale", r.code());
        assertEquals("pending", tickState("t1"));
        assertEquals(0, f.cars("released"));
        SupplyProvider recent = mutating(v -> v.put("observedAt", "2026-11-05T08:30:00.000Z"));
        assertNotEquals("stock-source-stale", with(recent).deliver(ctx, new TickEvent("t2", T0, 1)).code());
    }

    // 8
    @Test
    void invalidPullsAreRefusedWithNoStock() throws Exception {
        List<Consumer<ObjectNode>> bad = new ArrayList<>();
        bad.add(v -> ((com.fasterxml.jackson.databind.node.ArrayNode) v.get("stock")).add(v.get("stock").get(0).deepCopy()));
        bad.add(v -> ((ObjectNode) v.get("stock").get(0)).putObject("facts").putObject("nested").put("vin", "X"));
        bad.add(v -> v.put("runId", "other-run"));
        bad.add(v -> ((com.fasterxml.jackson.databind.node.ArrayNode) v.get("stock")).remove(0));
        bad.add(v -> ((ObjectNode) v.get("stock").get(0)).put("vin17", "X"));
        int n = 0;
        for (Consumer<ObjectNode> edit : bad) {
            ReleaseResult r = with(mutating(edit)).deliver(ctx, new TickEvent("bad-" + n, T0, 1));
            assertEquals(Status.INVALID, r.status(), "case " + n);
            assertEquals("invalid-stock-pull", r.code());
            assertEquals("refused", tickState("bad-" + n));
            n++;
        }
        assertEquals(0, f.cars("released"));
        assertEquals(0, f.releases());
    }

    @Test
    void oversizedTrancheIsRefused() throws Exception {
        policy.reading = new PolicyReading.Ok("test-policy-v1", 2, 1, 60);
        SupplyProvider ignoresSize = new Stubs.Provider(req -> plan.pull(new PullRequest(req.runId(), req.asOf(),
                req.tickId(), 5, req.leadTimeDays(), req.policyVersion(), req.released(), req.queuedSupply())));
        ReleaseResult r = with(ignoresSize).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.INVALID, r.status());
        assertEquals(0, f.cars("released"));
    }

    // 9
    @Test
    void missingPolicyReleasesNothing() throws Exception {
        ReleaseResult r = new StockRelease(f.pool(), new UnconfiguredPolicy(), plan).deliver(ctx,
                new TickEvent("t1", T0, 1));
        assertEquals(Status.UNAVAILABLE, r.status());
        assertEquals("pending", tickState("t1"));
        assertEquals(0, f.cars("released"));
        assertEquals(1, attempts("t1"));
    }

    // 10
    @Test
    void concurrentDeliveriesOfOneTickReleaseOnce() throws Exception {
        StockRelease a = new StockRelease(f.pool(), policy, plan);
        StockRelease b = new StockRelease(f.pool(), policy, plan);
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<ReleaseResult>> out = new ArrayList<>();
            for (StockRelease s : List.of(a, b)) {
                out.add(pool.submit(() -> {
                    go.await();
                    return s.deliver(ctx, new TickEvent("same", T0, 1));
                }));
            }
            go.countDown();
            for (Future<ReleaseResult> fr : out) {
                ReleaseResult r = fr.get(60, TimeUnit.SECONDS);
                assertEquals(Status.OK, r.status(), r.toString());
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(5, f.cars("released"));
        assertEquals(1, f.releases());
        assertEquals(1, f.count("SELECT count(*) FROM supply_release_ticks WHERE state = 'completed'"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'stock-released'"));
    }

    // 11
    @Test
    void restartCompletesPendingTicksOnceAndReplaysCompletedOnes() throws Exception {
        Stubs.Provider down = new Stubs.Provider(req -> new ProviderResponse.Unavailable("source-down", "down"));
        with(down).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals("pending", tickState("t1"));
        StockRelease restarted = new StockRelease(f.pool(), policy, plan);
        List<ReleaseResult> done = restarted.reconcilePending(ctx, 10);
        assertEquals(1, done.size());
        assertEquals(Status.OK, done.get(0).status());
        assertEquals(5, f.cars("released"));
        assertTrue(restarted.reconcilePending(ctx, 10).isEmpty());
        StockRelease again = new StockRelease(f.pool(), policy, plan);
        ReleaseResult replay = again.deliver(ctx, new TickEvent("t1", T0, 1));
        assertTrue(replay.replayed());
        assertEquals(1, f.releases());
    }

    @Test
    void reconcileWalksPendingTicksInDeliveryOrderWithinTheLimit() throws Exception {
        Stubs.Provider down = new Stubs.Provider(req -> new ProviderResponse.Unavailable("source-down", "down"));
        StockRelease sr = with(down);
        for (int i = 1; i <= 3; i++) sr.deliver(ctx, new TickEvent("t" + i, T0, 1));
        List<ReleaseResult> two = new StockRelease(f.pool(), policy, plan).reconcilePending(ctx, 2);
        assertEquals(2, two.size());
        assertEquals("t1", two.get(0).tickId());
        assertEquals("t2", two.get(1).tickId());
        assertEquals("pending", tickState("t3"));
    }

    // 12
    @Test
    void clockRulesAreForwardOnly() throws Exception {
        assertEquals(Status.OK, tick("a", T0, 2).status());
        ReleaseResult lower = tick("b", T0.plusSeconds(60), 1);
        assertEquals("release-clock-changed", lower.code());
        assertFalse(lower.retryable());
        assertEquals("release-clock-changed", tick("c", T0.plusSeconds(60), 2).code());
        assertEquals("release-clock-changed", tick("d", T0, 3).code());
        assertEquals("release-clock-changed", tick("e", T0.minusSeconds(60), 3).code());
        assertEquals(0, f.count("SELECT count(*) FROM supply_release_ticks WHERE tick_id IN ('b', 'c', 'd', 'e')"));
        assertEquals(Status.OK, tick("f", T0, 2).status());
        assertEquals(Status.OK, tick("g", T0.plusSeconds(60), 3).status());
    }

    @Test
    void aPendingTickBehindANewerClockIsRefused() throws Exception {
        Stubs.Provider down = new Stubs.Provider(req -> new ProviderResponse.Unavailable("source-down", "down"));
        StockRelease sr = with(down);
        sr.deliver(ctx, new TickEvent("old", T0, 1));
        sr.deliver(ctx, new TickEvent("new", T0.plusSeconds(60), 2));
        List<ReleaseResult> done = new StockRelease(f.pool(), policy, plan).reconcilePending(ctx, 10);
        assertEquals("release-clock-changed", done.get(0).code());
        assertEquals("refused", tickState("old"));
        assertEquals(Status.OK, done.get(1).status());
        assertEquals(5, f.cars("released"));
    }

    // 13
    @Test
    void availabilityEndIsPreservedAndAnEndedOneIsRefused() throws Exception {
        SupplyProvider future = mutating(v -> ((ObjectNode) v.get("stock").get(0)).putObject("availability")
                .put("availableUntil", "2026-11-12T09:00:00.000Z"));
        assertEquals(Status.OK, with(future).deliver(ctx, new TickEvent("t1", T0, 1)).status());
        JsonNode attrs = SupplyFixture.JSON.readTree(f.text(
                "SELECT attributes::text FROM stock_cars WHERE order_uuid = ?", CAR1));
        assertEquals("2026-11-12T09:00:00.000Z", attrs.get("release").get("availability").get("availableUntil").asText());
        assertFalse(attrs.has("availability"));
    }

    @Test
    void anEndedAvailabilityRefusesTheWholeRelease() throws Exception {
        SupplyProvider ended = mutating(v -> ((ObjectNode) v.get("stock").get(0)).putObject("availability")
                .put("availableUntil", "2026-11-05T09:00:00.000Z"));
        ReleaseResult r = with(ended).deliver(ctx, new TickEvent("t1", T0, 1));
        assertEquals(Status.INVALID, r.status());
        assertEquals(0, f.cars("released"));
        assertEquals(0, f.releases());
    }

    // 14
    @Test
    void retiredRunRefusesDelivery() throws Exception {
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        ReleaseResult r = tick("t1");
        assertEquals(Status.CONFLICT, r.status());
        assertEquals("stale-run", r.code());
        assertNull(f.text("SELECT tick_id FROM supply_release_ticks"));
    }

    @Test
    void invalidTickIsRefusedBeforeAnyWrite() throws Exception {
        assertEquals(Status.INVALID, release.deliver(ctx, new TickEvent("t", T0, 0)).status());
        assertEquals(Status.INVALID, release.deliver(ctx, new TickEvent("", T0, 1)).status());
        assertEquals(0, f.revision());
    }
}
