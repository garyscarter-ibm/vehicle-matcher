package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalFixture.FULL;
import static gcsp.api.approvals.ApprovalFixture.employee;
import static gcsp.api.approvals.ApprovalFixture.order;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Scoping, readiness, source and policy failures, tick conflicts and a competing instance. */
class ApprovalAccessTest {

    @Test
    void employeesSeeOnlyTheirOrdersAndForeignOnesAreForbiddenBeforeReadiness() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.orders.ready(order("o-p", "paula", FULL));
            f.orders.byId.put("o-pending", new OrderSourcePort.NotReady("paula", "selection-pending", "The selection is still being sent on."));
            f.orders.byId.put("o-alex-pending", new OrderSourcePort.NotReady("alex", "selection-pending", "x"));
            ApprovalResult own = f.service.read(f.ctx(), employee("paula"), "o-p");
            assertInstanceOf(ApprovalResult.Ok.class, own);
            ApprovalResult foreign = f.service.read(f.ctx(), employee("alex"), "o-p");
            assertEquals("not-resource-owner", assertInstanceOf(ApprovalResult.Forbidden.class, foreign).code());
            ApprovalResult hidden = f.service.read(f.ctx(), employee("paula"), "o-alex-pending");
            assertInstanceOf(ApprovalResult.Forbidden.class, hidden, "readiness of a foreign order is not revealed");
            assertInstanceOf(ApprovalResult.Ok.class, f.service.read(f.ctx(), f.greg.greg, "o-p"));
            assertInstanceOf(ApprovalResult.Ok.class, f.service.read(f.ctx(), f.greg.presenter, "o-p"));
            assertEquals(0, ApprovalFixture.value(f.service.list(f.ctx(), employee("alex"), null, 10)).get("orders").size());
            assertEquals(1, ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, null, 10)).get("orders").size());
            assertInstanceOf(ApprovalResult.NotFound.class, f.service.read(f.ctx(), f.greg.greg, "no-such-order"));
            ApprovalResult notReady = f.service.read(f.ctx(), f.greg.greg, "o-pending");
            ApprovalResult.Unavailable u = assertInstanceOf(ApprovalResult.Unavailable.class, notReady);
            assertEquals("selection-pending", u.code());
            assertEquals("not-ready", u.state());
            assertInstanceOf(ApprovalResult.Invalid.class, f.service.read(f.ctx(), f.greg.greg, ""));
            assertInstanceOf(ApprovalResult.Forbidden.class, f.service.read(f.ctx(), new ApprovalService.Reader(null, null), "o-p"));
        }
    }

    @Test
    void anUnconfiguredSourceIsUnavailableAndAListReadsHeadsInOneBatch() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            ApprovalService bare = new ApprovalService(f.pool(), f.policy, new UnconfiguredOrderSource(), null, null);
            ApprovalResult r = bare.read(f.ctx(), f.greg.greg, "o-1");
            assertEquals("order-source-not-configured", assertInstanceOf(ApprovalResult.Unavailable.class, r).code());
            assertEquals("order-source-not-configured", assertInstanceOf(ApprovalResult.Unavailable.class,
                    bare.list(f.ctx(), f.greg.greg, null, 10)).code());
            assertEquals("order-source-not-configured", assertInstanceOf(ApprovalResult.Unavailable.class,
                    bare.tick(f.ctx(), f.nextTick())).code());
            for (int i = 0; i < 5; i++) f.orders.ready(order("o-" + i, "paula", FULL));
            f.ticks(1);
            JsonNode page = ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, null, 3));
            assertEquals(3, page.get("orders").size());
            assertEquals("o-2", page.get("nextAfter").asText());
            JsonNode rest = ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, "o-2", 3));
            assertEquals(2, rest.get("orders").size());
            assertTrue(rest.get("nextAfter").isNull());
            assertEquals(1, rest.get("orders").get(0).get("lifecycleRevision").asInt());
        }
    }

    @Test
    void aPerOrderPolicyFailureIsListedAndSkippedWhileAPolicyWideFailureRefusesListAndTick() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.orders.ready(order("o-good", "paula", FULL));
            f.orders.ready(order("o-bad", "alex", List.of("unknown approval", "sent to ordering")));
            f.orders.byId.put("o-broken", new OrderSourcePort.Invalid("alex"));
            ApprovalResult first = f.tick();
            JsonNode result = ApprovalFixture.value(first);
            assertEquals(1, result.get("advanced").asInt());
            assertEquals("o-bad", result.get("failed").get(0).get("orderUuid").asText());
            assertEquals("lifecycle-policy-invalid", result.get("failed").get(0).get("code").asText());
            assertEquals("HR approval", f.view("o-good").get("currentStage").asText());
            ApprovalResult.Unavailable bad = assertInstanceOf(ApprovalResult.Unavailable.class,
                    f.service.read(f.ctx(), f.greg.greg, "o-bad"));
            assertEquals("lifecycle-policy-invalid", bad.code());
            JsonNode listed = ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, null, 10));
            assertEquals(1, listed.get("orders").size());
            assertEquals(2, listed.get("failedCount").asInt());
            assertEquals(List.of("lifecycle-policy-invalid", "selection-source-invalid"),
                    java.util.stream.StreamSupport.stream(listed.get("failed").spliterator(), false)
                            .map(n -> n.get("code").asText()).sorted().toList());

            f.policy.fault = new ApprovalPolicyPort.Unavailable("policy-source-invalid");
            long revisions = f.count("SELECT count(*) FROM approval_revisions");
            ApprovalResult.Unavailable wide = assertInstanceOf(ApprovalResult.Unavailable.class,
                    f.service.list(f.ctx(), f.greg.greg, null, 10));
            assertEquals("policy-source-invalid", wide.code());
            assertTrue(wide.policyWide());
            assertEquals("policy-source-invalid", assertInstanceOf(ApprovalResult.Unavailable.class,
                    f.service.read(f.ctx(), f.greg.greg, "o-good")).code());
            ApprovalResult.Unavailable tick = assertInstanceOf(ApprovalResult.Unavailable.class, f.tick());
            assertEquals("policy-source-invalid", tick.code());
            assertEquals(revisions, f.count("SELECT count(*) FROM approval_revisions"), "nothing advanced");

            f.policy.fault = new ApprovalPolicyPort.VersionNotFound();
            JsonNode scoped = ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, null, 10));
            assertEquals(0, scoped.get("orders").size());
            assertEquals(List.of("lifecycle-policy-unavailable", "lifecycle-policy-unavailable", "selection-source-invalid"),
                    java.util.stream.StreamSupport.stream(scoped.get("failed").spliterator(), false)
                            .map(n -> n.get("code").asText()).sorted().toList());
            f.policy.fault = null;
            f.policy.throwing = true;
            assertEquals("policy-source-unavailable", assertInstanceOf(ApprovalResult.Unavailable.class,
                    f.service.list(f.ctx(), f.greg.greg, null, 10)).code());
            f.policy.throwing = false;
            ApprovalService noPolicy = new ApprovalService(f.pool(), null, f.orders, null, null);
            assertEquals("lifecycle-policy-unavailable", assertInstanceOf(ApprovalResult.Unavailable.class,
                    noPolicy.list(f.ctx(), f.greg.greg, null, 10)).code());
        }
    }

    @Test
    void tickConflictsAreRefusedWithoutWriting() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.orders.ready(order("o-c", "paula", FULL));
            ApprovalService.TickInput first = f.nextTick();
            assertInstanceOf(ApprovalResult.Ok.class, f.service.tick(f.ctx(), first));
            ApprovalResult changed = f.service.tick(f.ctx(), new ApprovalService.TickInput(first.tickId(),
                    first.now().plusSeconds(60), first.clockVersion()));
            assertEquals("tick-input-changed", assertInstanceOf(ApprovalResult.Conflict.class, changed).code());
            ApprovalService.TickInput second = f.nextTick();
            assertInstanceOf(ApprovalResult.Ok.class, f.service.tick(f.ctx(), second));
            List<Long> before = f.snapshot();
            // Lower clock version, same version with another time, and a higher version that does not move time on.
            for (ApprovalService.TickInput bad : List.of(
                    new ApprovalService.TickInput("stale", second.now().plusSeconds(5), second.clockVersion() - 1),
                    new ApprovalService.TickInput("same-v", second.now().plusSeconds(5), second.clockVersion()),
                    new ApprovalService.TickInput("not-later", second.now(), second.clockVersion() + 1))) {
                assertEquals("approval-clock-changed", assertInstanceOf(ApprovalResult.Conflict.class,
                        f.service.tick(f.ctx(), bad)).code(), bad.tickId());
            }
            assertEquals(before, f.snapshot());
            assertInstanceOf(ApprovalResult.Invalid.class, f.service.tick(f.ctx(), new ApprovalService.TickInput("", f.nextTick().now(), 1)));
        }
    }

    @Test
    void aCompetingInstanceRunningTheSameTickDoesNotDoubleCount() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            for (int i = 0; i < 4; i++) f.orders.ready(order("o-" + i, "paula", FULL));
            f.ticks(2);
            ApprovalService other = f.newService(f.pool(), new SyntheticApprovalStatus(f.pool()));
            ApprovalService.TickInput tick = f.nextTick();
            java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
            try {
                java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.Future<ApprovalResult> a = pool.submit(() -> {
                    go.await();
                    return f.service.tick(f.ctx(), tick);
                });
                java.util.concurrent.Future<ApprovalResult> b = pool.submit(() -> {
                    go.await();
                    return other.tick(f.ctx(), tick);
                });
                go.countDown();
                a.get(60, java.util.concurrent.TimeUnit.SECONDS);
                b.get(60, java.util.concurrent.TimeUnit.SECONDS);
            } finally {
                pool.shutdownNow();
            }
            for (int i = 0; i < 4; i++) {
                // Third tick made each HR decision due once: exactly one approval and one decision per stage.
                assertEquals("approved", f.view("o-" + i).get("stages").get(1).get("state").asText());
                assertEquals(1, f.count("SELECT count(*) FROM approval_decisions WHERE order_uuid = ? AND stage = 'HR approval'", "o-" + i));
                assertEquals(2, f.count("SELECT ticks_elapsed FROM approval_decisions WHERE order_uuid = ? AND stage = 'HR approval'", "o-" + i));
                assertEquals(2, f.count("SELECT count(*) FROM approval_decisions WHERE order_uuid = ?", "o-" + i));
                assertEquals(2, f.count("SELECT count(*) FROM approval_revisions WHERE order_uuid = ?", "o-" + i) - 0,
                        "start and the HR approval only");
            }
            assertEquals(4, f.count("SELECT count(*) FROM approval_synthetic_decisions"));
            assertEquals("completed", f.text("SELECT state FROM approval_ticks WHERE tick_id = ?", tick.tickId()));
        }
    }
}
