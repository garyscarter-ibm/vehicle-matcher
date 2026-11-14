package gcsp.api.returns;

import static gcsp.api.returns.PlansHarness.HANDOVER_SLOT;
import static gcsp.api.returns.PlansHarness.ORDER;
import static gcsp.api.returns.PlansHarness.assertRefused;
import static gcsp.api.returns.PlansHarness.ok;
import static gcsp.api.returns.PlansHarness.refused;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReturnPlansProgressTest {

    static final long DELAY = 1800;

    @TempDir Path dir;
    PlansHarness h;

    @AfterEach
    void tearDown() throws Exception {
        if (h != null) h.close();
    }

    PlansHarness harness(java.util.function.Consumer<ObjectNode> edit) throws Exception {
        h = new PlansHarness(dir, edit);
        return h;
    }

    String state(String sql) throws Exception {
        return h.f.text(sql, ORDER);
    }

    @Test
    void aProposedChangeIsAcceptedAndOnlyThenScheduled() throws Exception {
        harness(d -> ((ObjectNode) ReturnsFixture.row(d, RetainedReturnPolicy.SCENARIO).get("value")).put("proposeChange", true));
        String slot = h.firstSlot("separate");
        ok(h.request("c-1", "separate", slot, 0));
        h.advance(DELAY);
        assertEquals(1, h.progress(true).applied());
        JsonNode proposed = h.plan();
        assertEquals("return-requested", proposed.path("state").asText(), "a proposed change is still a request");
        assertEquals("change-proposed", proposed.path("appointment").path("state").asText());
        assertEquals("employee", proposed.path("owner").asText());
        assertTrue(proposed.path("slot").isNull());
        String alt = proposed.path("proposedSlot").path("slotId").asText();
        assertFalse(alt.isEmpty());
        assertFalse(alt.equals(slot));
        String proposalId = proposed.path("proposalId").asText();
        assertTrue(proposalId.startsWith("SYN-APT-"));
        long version = proposed.path("version").asLong();

        assertRefused(400, "invalid-return-command", h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-bad", ORDER, "nope", version));
        assertRefused(409, "stale-version", h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-stale", ORDER, proposalId, version - 1));
        JsonNode accepted = ok(h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-1", ORDER, proposalId, version));
        assertEquals("return-scheduled", accepted.path("state").asText());
        assertEquals(alt, accepted.path("slot").path("slotId").asText());
        assertEquals(slot, accepted.path("requestedSlot").path("slotId").asText());
        assertEquals(java.util.List.of("return-requested", "return-requested", "return-scheduled"),
                java.util.stream.StreamSupport.stream(accepted.path("history").spliterator(), false)
                        .map(n -> n.path("state").asText()).toList());
        assertEquals(3, accepted.path("history").size());
        assertEquals("change-proposed", accepted.path("history").get(1).path("appointmentState").asText());
        assertEquals(proposalId, state("SELECT accepted_proposal_id FROM return_plans WHERE order_uuid = ?"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));

        // A repeat after acceptance returns the plan; so does the same command id.
        assertEquals(accepted, ok(h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-2", ORDER, proposalId, version)));
        assertEquals(accepted, ok(h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-1", ORDER, proposalId, version)));
        assertEquals(3, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertRefused(409, "no-change-proposed", h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-3", ORDER, "other", version));
    }

    @Test
    void acceptWithoutAProposalIsRefused() throws Exception {
        harness(d -> {});
        assertRefused(404, "not-found", h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-0", ORDER, "p", 0));
        ok(h.request("c-1", "separate", h.firstSlot("separate"), 0));
        long v = h.plan().path("version").asLong();
        assertRefused(409, "no-change-proposed", h.plans.acceptChange(h.ctx(), PlansHarness.PAULA, "a-1", ORDER, "p", v));
    }

    @Test
    void anUncertainRequestSurvivesRestartAndReconcilesWithoutADuplicateWrite() throws Exception {
        harness(d -> {});
        String slot = h.firstSlot("separate");
        h.provider.failOnce(FlakyReturnProvider.Fault.THROW_BEFORE);
        PlanResult.Pending pending = assertInstanceOf(PlanResult.Pending.class, h.request("c-1", "separate", slot, 0));
        JsonNode p = pending.json();
        assertEquals("not-planned", p.path("state").asText());
        assertEquals("request", p.path("pending").path("step").asText());
        assertEquals("scheme-team", p.path("owner").asText());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals("pending", state("SELECT state FROM pending_operations WHERE operation_id LIKE '%:request' AND ? IS NOT NULL"));
        assertEquals("unknown", state("SELECT pending_last_known FROM return_plans WHERE order_uuid = ?"));

        // Restart: a new pool, a new instance, a new provider. Startup is reconcile-only.
        FlakyReturnProvider fresh = new FlakyReturnProvider(new SyntheticReturnProvider(h.f.pool()));
        h.restart(fresh);
        ReturnPlans.Summary startup = h.progress(false);
        assertEquals(1, startup.orders());
        assertEquals(1, startup.waiting());
        assertEquals(0, fresh.writes.get(), "startup writes nothing to the provider");
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertTrue(h.plan().path("pending").isObject());

        ReturnPlans.Summary tick = h.progress(true);
        assertEquals(1, tick.applied());
        assertEquals(1, fresh.writes.get());
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        JsonNode done = h.plan();
        assertEquals("return-requested", done.path("state").asText());
        assertTrue(done.path("pending").isNull());
        assertEquals(1, done.path("history").size());
        assertEquals("acknowledged", state("SELECT state FROM pending_operations WHERE operation_id LIKE '%:request' AND ? IS NOT NULL"));
        // The same command id still answers the plan, and no further provider write happens.
        assertEquals(done, ok(h.request("c-1", "separate", slot, 0)));
        assertEquals(1, fresh.writes.get());
    }

    @Test
    void aLostAcknowledgementReconcilesToTheStoredAnswerEvenOnStartup() throws Exception {
        harness(d -> {});
        h.provider.failOnce(FlakyReturnProvider.Fault.THROW_AFTER);
        assertInstanceOf(PlanResult.Pending.class, h.request("c-1", "separate", h.firstSlot("separate"), 0));
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        FlakyReturnProvider fresh = new FlakyReturnProvider(new SyntheticReturnProvider(h.f.pool()));
        h.restart(fresh);
        assertEquals(1, h.progress(false).applied());
        assertEquals(0, fresh.writes.get());
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals("return-requested", h.plan().path("state").asText());
    }

    @Test
    void aProviderTimeoutIsUnknownAndStaysPending() throws Exception {
        harness(d -> ((ObjectNode) ReturnsFixture.row(d, RetainedReturnPolicy.CONFIRMATION).get("value")).put("providerTimeoutMs", 100));
        h.provider.failOnce(FlakyReturnProvider.Fault.HANG);
        long start = System.nanoTime();
        PlanResult.Pending pending = assertInstanceOf(PlanResult.Pending.class, h.request("c-1", "separate", h.firstSlot("separate"), 0));
        assertTrue((System.nanoTime() - start) / 1_000_000 < 3000, "the call is cut at the policy timeout");
        assertTrue(pending.operationId().endsWith(":request"));
        assertEquals("unknown", state("SELECT pending_last_known FROM return_plans WHERE order_uuid = ?"));
        assertEquals(1, h.progress(true).applied());
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void aLiveProviderRefusalBlocksAndWritesNothingElse() throws Exception {
        harness(d -> {});
        h.restart(new LiveReturnProviderStub());
        PlanResult.Refused r = refused(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        assertEquals(422, r.http());
        assertEquals(LiveReturnProviderStub.APPOINTMENTS_CODE, r.code());
        assertFalse(r.retryable());
        JsonNode plan = r.plan();
        assertEquals(LiveReturnProviderStub.APPOINTMENTS_CODE, plan.path("blocked").path("code").asText());
        assertEquals("not-planned", plan.path("state").asText());
        assertEquals("scheme-team", plan.path("owner").asText());
        assertTrue(plan.path("pending").isNull());
        assertEquals("live", plan.path("provider").path("mode").asText());
        assertFalse(plan.path("provider").path("synthetic").asBoolean());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals("refused", state("SELECT state FROM pending_operations WHERE operation_id LIKE '%:request' AND ? IS NOT NULL"));
        assertEquals("request", state("SELECT blocked_step FROM return_plans WHERE order_uuid = ?"));
        assertEquals("not-requested", state("SELECT state FROM return_plans WHERE order_uuid = ?"));
        // Ticks leave a refused plan alone, and a repeat of the request answers the same refusal.
        h.advance(DELAY * 2);
        ReturnPlans.Summary tick = h.progress(true);
        assertEquals(0, tick.orders());
        PlanResult.Refused again = refused(h.request("c-2", "same-visit", HANDOVER_SLOT.slotId(), plan.path("version").asLong()));
        assertEquals(LiveReturnProviderStub.APPOINTMENTS_CODE, again.code());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void aLiveSeparateChoiceIsNotOfferedAndIsRefusedAsNotReady() throws Exception {
        harness(d -> {});
        h.restart(new LiveReturnProviderStub());
        JsonNode plan = h.plan();
        assertEquals(java.util.List.of("true", "false"), java.util.stream.StreamSupport.stream(plan.path("choices").spliterator(), false)
                .map(n -> n.path("available").asText()).toList());
        assertRefused(409, "handover-not-ready", h.request("c-1", "separate", "slot-20261107T1300Z", 0));
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
    }

    @Test
    void progressSkipsOneFailureAndKeepsGoing() throws Exception {
        harness(d -> {});
        ok(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        h.source.put(InMemoryReturnSource.replacement("order-2", "emp-1"));
        h.handover.put("order-2", new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-HANDOVER2"));
        assertEquals("return-requested", ok(h.plans.request(h.ctx(), PlansHarness.PAULA, "c-2", "order-2", "same-visit",
                HANDOVER_SLOT.slotId(), 0)).path("state").asText());
        h.advance(DELAY);
        // A policy that no longer reads for one plan's version fails the whole page identically, so use a fresh failure.
        h.provider.failOnce(FlakyReturnProvider.Fault.THROW_BEFORE);
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(2, s.orders());
        assertEquals(1, s.applied());
        assertEquals(1, s.uncertain());
        assertEquals(0, s.failed().size());
        ReturnPlans.Summary next = h.progress(true);
        assertEquals(2, next.orders());
        assertEquals(1, next.applied());
        assertEquals(1, next.idle() + next.waiting());
    }

    @Test
    void statementCountsPerCommandDoNotGrowWithTheRun() throws Exception {
        harness(d -> {});
        CountingDataSource counting = new CountingDataSource(h.f.pool());
        h.plans.close();
        h.plans = new ReturnPlans(h.policy, h.source, h.handover, h.clock, h.provider, new CurrentCarStore(counting),
                new gcsp.api.persistence.TransactionRunner(counting), counting);
        int readEmpty = measure(() -> h.read(ORDER));
        int requestEmpty = measure(() -> h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        int readPlanned = measure(() -> h.read(ORDER));
        for (int i = 0; i < 30; i++) {
            String o = "bulk-" + i;
            h.source.put(InMemoryReturnSource.replacement(o, "emp-1"));
            h.handover.put(o, new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-H" + i));
            ok(h.plans.request(h.ctx(), PlansHarness.PAULA, "c-" + o, o, "same-visit", HANDOVER_SLOT.slotId(), 0));
        }
        assertEquals(31, h.f.count("SELECT count(*) FROM return_plans"));
        h.source.put(InMemoryReturnSource.replacement("order-last", "emp-1"));
        h.handover.put("order-last", new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-HL"));
        assertEquals(readEmpty, measure(() -> h.read("order-last")));
        assertEquals(requestEmpty, measure(() -> h.plans.request(h.ctx(), PlansHarness.PAULA, "c-last", "order-last",
                "same-visit", HANDOVER_SLOT.slotId(), 0)));
        assertEquals(readPlanned, measure(() -> h.read(ORDER)));
        assertTrue(readEmpty <= 4 && requestEmpty <= 24, "reads=" + readEmpty + " request=" + requestEmpty);
    }

    @Test
    void progressPagesByKeysetAcrossMoreThanOnePage() throws Exception {
        harness(d -> {});
        int n = ReturnPlans.PAGE + 5;
        for (int i = 0; i < n; i++) {
            String o = String.format("bulk-%03d", i);
            h.source.put(InMemoryReturnSource.replacement(o, "emp-1"));
            h.handover.put(o, new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-H" + i));
            ok(h.plans.request(h.ctx(), PlansHarness.PAULA, "c-" + o, o, "same-visit", HANDOVER_SLOT.slotId(), 0));
        }
        h.advance(DELAY);
        ReturnPlans.Summary s = h.progress(true);
        assertEquals(n, s.orders());
        assertEquals(n, s.applied());
        assertTrue(s.failed().isEmpty());
        assertEquals(n, h.f.count("SELECT count(*) FROM return_plans WHERE state = 'scheduled'"));
        ReturnPlans.Summary again = h.progress(true);
        assertEquals(n, again.orders(), "scheduled plans stay in the progress index");
        assertEquals(n, again.idle(), "but need no provider work");
        assertEquals(2 * n, h.f.count("SELECT count(*) FROM return_provider_receipts"), "request and confirm each");
    }

    private int measure(java.util.function.Supplier<PlanResult> op) throws Exception {
        CountingDataSource counting = null;
        java.lang.reflect.Field f = ReturnPlans.class.getDeclaredField("dataSource");
        f.setAccessible(true);
        counting = (CountingDataSource) f.get(h.plans);
        int before = counting.statements.get();
        PlanResult r = op.get();
        assertFalse(r instanceof PlanResult.Refused, String.valueOf(r));
        return counting.statements.get() - before;
    }
}
