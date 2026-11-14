package gcsp.api.returns;

import static gcsp.api.returns.PlansHarness.EMP;
import static gcsp.api.returns.PlansHarness.HANDOVER_SLOT;
import static gcsp.api.returns.PlansHarness.ORDER;
import static gcsp.api.returns.PlansHarness.assertRefused;
import static gcsp.api.returns.PlansHarness.ok;
import static gcsp.api.returns.PlansHarness.refused;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReturnPlansTest {

    static final long DELAY = 1800;

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

    List<String> list(JsonNode arrayOfObjects, String field) {
        List<String> out = new ArrayList<>();
        arrayOfObjects.forEach(n -> out.add(n.path(field).asText()));
        return out;
    }

    void assertCarUntouched() throws Exception {
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));
        JsonNode rel = h.plan().path("relationship");
        assertEquals("contract", rel.path("currentCar").path("kind").asText());
        assertEquals("held", rel.path("oldCar").path("status").asText());
        assertEquals("on-order", rel.path("newCar").path("status").asText());
    }

    // Port of: a replacement order has a return plan linked to the old contract and slot; a new order has none.
    @Test
    void replacementOrderHasAPlanAndNewOrderHasNone() throws Exception {
        h.handover.put(ORDER, new HandoverReading.Found("not-requested", null, null));
        JsonNode plan = h.plan();
        assertEquals("lifecycle.return-plan.v1", plan.path("contractVersion").asText());
        assertEquals("not-planned", plan.path("state").asText());
        assertTrue(plan.path("applicable").asBoolean());
        assertFalse(plan.path("scheduled").asBoolean());
        assertEquals("not-requested", plan.path("appointment").path("state").asText());
        assertEquals("return", plan.path("appointment").path("purpose").asText());
        assertEquals("contract-1", plan.path("oldContractId").asText());
        assertEquals("slot-ent-1", plan.path("vehicleSlotId").asText());
        assertEquals(EMP, plan.path("employeeId").asText());
        assertEquals("run-1", plan.path("runId").asText());
        assertEquals("selection", plan.path("currentCar").path("source").asText());
        assertEquals("contract-1", plan.path("currentCar").path("contractId").asText());
        assertEquals(12000, plan.path("returnMileage").path("value").asInt());
        assertEquals("selection", plan.path("returnMileage").path("source").asText());
        assertEquals("loc-1", plan.path("location").path("locationId").asText());
        assertEquals("collection-location", plan.path("location").path("kind").asText());
        assertTrue(plan.path("fictional").asBoolean());
        assertFalse(plan.path("handover").path("booked").asBoolean());
        assertEquals("not-requested", plan.path("handover").path("state").asText());
        assertEquals("employee", plan.path("owner").asText());
        assertEquals("Confirm your new car's handover first, then plan the return.", plan.path("nextStep").asText());
        assertTrue(plan.path("choices").findValues("available").stream().noneMatch(JsonNode::asBoolean));
        assertTrue(plan.path("outcome").isNull());
        assertEquals("test-policy-v1", plan.path("policyVersion").asText());
        assertEquals("synthetic", plan.path("provider").path("mode").asText());
        assertEquals("selection-op-1", plan.path("source").path("reference").asText());
        assertEquals(0, plan.path("version").asInt());
        assertTrue(plan.path("assumptions").size() >= 2);

        PlansHarness.assertRefused(409, "handover-not-ready", h.request("c-early", "separate", "slot-20261107T1300Z", 0));
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
        assertEquals(0, h.f.count("SELECT count(*) FROM pending_operations"));

        h.source.put(InMemoryReturnSource.newOrder("order-new", EMP));
        JsonNode none = ok(h.plans.read(h.ctx(), PlansHarness.PAULA, "order-new"));
        assertFalse(none.path("applicable").asBoolean());
        assertTrue(none.path("state").isNull());
        assertTrue(none.path("appointment").isNull());
        assertTrue(none.path("currentCar").isNull());
        assertTrue(none.path("returnMileage").isNull());
        assertEquals(0, none.path("choices").size());
        assertEquals(0, none.path("offeredSlots").size());
        assertEquals("test-policy-v1", none.path("policyVersion").asText());
        PlanResult refusedNew = h.plans.request(h.ctx(), PlansHarness.PAULA, "c-new", "order-new", "separate",
                "slot-20261107T1300Z", 0);
        assertRefused(409, "return-not-applicable", refusedNew);

        h.source.put("order-bad", ReturnSourceReading.invalid());
        PlanResult.Refused bad = refused(h.plans.read(h.ctx(), PlansHarness.PAULA, "order-bad"));
        assertEquals("return-plan-source-invalid", bad.code());
        assertFalse(bad.retryable());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
    }

    // Port of: return states: requested is never scheduled, then a separate appointment is scheduled.
    @Test
    void requestedIsNeverScheduledUntilTheProviderConfirms() throws Exception {
        JsonNode open = h.plan();
        assertEquals("not-planned", open.path("state").asText());
        assertEquals("scheduled", open.path("handover").path("state").asText());
        assertTrue(open.path("handover").path("booked").asBoolean());
        assertEquals(List.of("true", "true"), list(open.path("choices"), "available"));
        assertEquals("Choose when to return your current car.", open.path("nextStep").asText());
        String slot = h.firstSlot("separate");

        JsonNode requested = ok(h.request("c-1", "separate", slot, 0));
        assertEquals("return-requested", requested.path("state").asText());
        assertFalse(requested.path("scheduled").asBoolean());
        assertEquals("separate", requested.path("choice").asText());
        assertTrue(requested.path("slot").isNull());
        assertEquals(slot, requested.path("requestedSlot").path("slotId").asText());
        assertEquals("retailer", requested.path("owner").asText());
        assertEquals(1, requested.path("history").size());
        assertEquals("return-requested", requested.path("history").get(0).path("state").asText());
        assertEquals("requested", requested.path("history").get(0).path("appointmentState").asText());
        assertEquals("2026-11-05T09:00:00.000Z", requested.path("history").get(0).path("at").asText());
        assertTrue(requested.path("history").get(0).path("providerReference").asText().startsWith("SYN-APT-"));
        assertEquals("loc-1", requested.path("location").path("locationId").asText());
        assertEquals("handover-retailer", requested.path("location").path("rule").asText());
        assertEquals(2, requested.path("version").asInt(), "intent at 1, settled by CAS to 2");
        assertCarUntouched();

        h.advance(60);
        ReturnPlans.Summary early = h.progress(true);
        assertEquals(1, early.orders());
        assertEquals(1, early.waiting());
        assertEquals("return-requested", h.plan().path("state").asText(), "before the keyed delay the retailer has not answered");

        h.advance(DELAY);
        ReturnPlans.Summary done = h.progress(true);
        assertEquals(1, done.applied());
        JsonNode scheduled = h.plan();
        assertEquals("return-scheduled", scheduled.path("state").asText());
        assertTrue(scheduled.path("scheduled").asBoolean());
        assertEquals(slot, scheduled.path("slot").path("slotId").asText());
        assertTrue(scheduled.path("appointment").path("booked").asBoolean());
        assertEquals("Keep driving your current car until the return.", scheduled.path("nextStep").asText());
        assertEquals(List.of("return-requested", "return-scheduled"), list(scheduled.path("history"), "state"));
        assertEquals(List.of("requested", "scheduled"), list(scheduled.path("history"), "appointmentState"));
        assertEquals(scheduled.path("history").get(1).path("providerReference").asText(),
                scheduled.path("providerReference").asText());
        assertEquals(ReturnJson.format(h.clock.now), scheduled.path("history").get(1).path("at").asText());
        assertCarUntouched();

        // The handover is untouched, and its reference never coincides with either return reference.
        assertEquals("SYN-APT-HANDOVER1", scheduled.path("handover").path("providerReference").asText());
        Set<String> refs = new HashSet<>(list(scheduled.path("history"), "providerReference"));
        refs.add(scheduled.path("handover").path("providerReference").asText());
        assertEquals(3, refs.size());
        assertEquals(2, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals(2, h.f.count("SELECT count(DISTINCT operation_id) FROM return_operations"));

        // Repeating the booked request returns the same plan; a different choice or slot is refused.
        assertEquals(scheduled, ok(h.request("c-1b", "separate", slot, scheduled.path("version").asLong())));
        assertRefused(409, "appointment-already-requested",
                h.request("c-2", "separate", "slot-20261108T0900Z", scheduled.path("version").asLong()));
        assertRefused(409, "appointment-already-requested",
                h.request("c-3", "same-visit", HANDOVER_SLOT.slotId(), scheduled.path("version").asLong()));
        JsonNode after = h.plan();
        assertEquals(List.of("false", "false"), list(after.path("choices"), "available"));
        assertEquals(List.of("false", "true"), list(after.path("choices"), "selected"));
        assertEquals("Your return is already planned.", after.path("choices").get(0).path("reason").asText());
        assertEquals(2, h.f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    // Port of: same-visit and separate choices follow the canonical policy keys, and changing a key changes the offer.
    @Test
    void choicesFollowThePolicyKeys() throws Exception {
        JsonNode plan = h.plan();
        List<String> grid = new ArrayList<>();
        plan.path("offeredSlots").path("separate").forEach(s -> grid.add(s.path("start").asText()));
        // Lead 2 days from 2026-11-05, 10 days, 09:00 and 13:00; from handover end (11-07 10:00) to +7 days.
        assertEquals("2026-11-07T13:00:00.000Z", grid.get(0));
        assertEquals("2026-11-14T09:00:00.000Z", grid.get(grid.size() - 1));
        assertEquals(14, grid.size(), "one on the first day, six full days, one on the last");
        assertEquals(1, plan.path("offeredSlots").path("same-visit").size());
        assertEquals(HANDOVER_SLOT.slotId(), plan.path("offeredSlots").path("same-visit").get(0).path("slotId").asText());
        assertEquals("Return it when the new car is handed over", plan.path("choices").get(0).path("label").asText());
        assertTrue(plan.path("assumptions").findValuesAsText("key").containsAll(
                List.of("lifecycle.return.options.v1", "lifecycle.return.ownership.v1")));

        // A policy edit changes the offer: lead 3 days, 2 days, one daily time, window 2 days.
        try (PlansHarness alt = new PlansHarness(dir, d -> {
            var sep = ReturnsFixture.row(d, RetainedReturnPolicy.OPTIONS).get("value").get("rules").get("separate");
            var slots = (com.fasterxml.jackson.databind.node.ObjectNode) sep.get("slots");
            slots.put("earliestLeadDays", 3).put("daysOffered", 2).put("slotMinutes", 30);
            slots.putArray("dailyStartTimes").add("10:00");
            ((com.fasterxml.jackson.databind.node.ObjectNode) sep).put("maxDaysAfterHandover", 2);
        })) {
            JsonNode altPlan = alt.plan();
            List<String> starts = new ArrayList<>();
            altPlan.path("offeredSlots").path("separate").forEach(s -> starts.add(s.path("start").asText()));
            assertEquals(List.of("2026-11-08T10:00:00.000Z", "2026-11-09T10:00:00.000Z"), starts);
        }

        // Same visit books the handover's own slot as a second appointment.
        JsonNode same = ok(h.request("c-same", "same-visit", HANDOVER_SLOT.slotId(), 0));
        assertEquals("same-visit", same.path("choice").asText());
        assertEquals("return-requested", same.path("state").asText());
        assertEquals(HANDOVER_SLOT.slotId(), same.path("requestedSlot").path("slotId").asText());
        h.advance(DELAY);
        h.progress(true);
        JsonNode done = h.plan();
        assertEquals("return-scheduled", done.path("state").asText());
        assertEquals(HANDOVER_SLOT.slotId(), done.path("slot").path("slotId").asText());
        assertNotEquals(done.path("providerReference").asText(), done.path("handover").path("providerReference").asText());
    }

    @Test
    void unknownChoiceAndUnofferedSlotsAreInvalid() throws Exception {
        String slot = h.firstSlot("separate");
        PlanResult.Refused weekly = refused(h.request("c-a", "weekly", slot, 0));
        assertEquals(400, weekly.http());
        assertEquals("invalid-return-command", weekly.code());
        assertEquals("choice", weekly.reasons().get(0).field());
        PlanResult.Refused sameSlot = refused(h.request("c-b", "same-visit", slot, 0));
        assertEquals("slotId", sameSlot.reasons().get(0).field());
        PlanResult.Refused early = refused(h.request("c-c", "separate", HANDOVER_SLOT.slotId(), 0));
        assertEquals("invalid-return-command", early.code(), "the handover slot is before the separate window");
        assertRefused(400, "invalid-return-command", h.request("", "separate", slot, 0));
        assertRefused(400, "invalid-return-command", h.request("x".repeat(201), "separate", slot, 0));
        assertRefused(400, "invalid-return-command", h.request("c-d", "separate", slot, -1));
        assertEquals("not-planned", h.plan().path("state").asText());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
    }

    @Test
    void aRuleThatFailsValidationIsRefusedNotDefaulted() throws Exception {
        try (PlansHarness bad = new PlansHarness(dir, d -> ((com.fasterxml.jackson.databind.node.ObjectNode) ReturnsFixture
                .row(d, RetainedReturnPolicy.OPTIONS).get("value").get("choices").get(0)).put("label", "Return it — now"))) {
            PlanResult.Refused r = refused(bad.read(ORDER));
            assertEquals(503, r.http());
            assertEquals("return-policy-unavailable", r.code());
            assertTrue(r.retryable());
        }
    }

    // Port of: the current car is unchanged through selection, approvals, handover and return planning.
    @Test
    void theCurrentCarIsUnchangedThroughReturnPlanning() throws Exception {
        assertCarUntouched();
        assertTrue(ok(h.request("c-1", "separate", h.firstSlot("separate"), 0)).path("fictional").asBoolean());
        assertCarUntouched();
        h.advance(DELAY);
        h.progress(true);
        assertEquals("return-scheduled", h.plan().path("state").asText());
        assertCarUntouched();
        assertEquals("contract-1", h.plan().path("relationship").path("oldCar").path("contractId").asText());
        assertEquals("contract", h.plan().path("relationship").path("currentCar").path("kind").asText());
    }

    @Test
    void aRepeatedCommandIdReplaysAndChangedInputConflicts() throws Exception {
        String slot = h.firstSlot("separate");
        JsonNode first = ok(h.request("c-1", "separate", slot, 0));
        JsonNode again = ok(h.request("c-1", "separate", slot, 0));
        assertEquals(first, again);
        assertEquals(1, h.f.count("SELECT count(*) FROM return_plans"));
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals(1, h.f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'return-requested'"));
        PlanResult.Refused changed = refused(h.request("c-1", "separate", "slot-20261108T0900Z", 0));
        assertEquals(409, changed.http());
        assertEquals("command-input-changed", changed.code());
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts"));
    }

    @Test
    void aStaleExpectedVersionIsRefusedWithTheCurrentVersion() throws Exception {
        String slot = h.firstSlot("separate");
        ok(h.request("c-1", "separate", slot, 0));
        h.advance(DELAY);
        h.progress(true);
        long version = h.plan().path("version").asLong();
        assertTrue(version > 1);
        PlanResult.Refused stale = refused(h.request("c-2", "same-visit", HANDOVER_SLOT.slotId(), 1));
        assertEquals(409, stale.http());
        assertEquals("stale-version", stale.code());
        assertTrue(stale.reason().contains(Long.toString(version)));
        assertEquals("return-scheduled", stale.plan().path("state").asText());
        // A first request that claims an existing plan was read is stale too.
        h.source.put(InMemoryReturnSource.replacement("order-2", EMP));
        h.handover.put("order-2", new HandoverReading.Found("scheduled", HANDOVER_SLOT, "SYN-APT-HANDOVER2"));
        PlanResult.Refused none = refused(h.plans.request(h.ctx(), PlansHarness.PAULA, "c-3", "order-2", "same-visit",
                HANDOVER_SLOT.slotId(), 4));
        assertEquals("stale-version", none.code());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans WHERE order_uuid = 'order-2'"));
    }

    @Test
    void rolesAndOwnershipAreEnforced() throws Exception {
        String slot = h.firstSlot("separate");
        for (ReturnPlans.Caller c : List.of(ReturnPlans.Caller.greg(), ReturnPlans.Caller.presenter())) {
            assertRefused(403, "role-required", h.plans.request(h.ctx(), c, "c-r", ORDER, "separate", slot, 0));
            assertRefused(403, "role-required", h.plans.acceptChange(h.ctx(), c, "c-a", ORDER, "p", 0));
            assertEquals(EMP, ok(h.plans.read(h.ctx(), c, ORDER)).path("employeeId").asText(), "Greg and the presenter read any order");
        }
        ReturnPlans.Caller other = ReturnPlans.Caller.employee("emp-2");
        assertRefused(403, "not-resource-owner", h.plans.read(h.ctx(), other, ORDER));
        assertRefused(403, "not-resource-owner", h.plans.request(h.ctx(), other, "c-o", ORDER, "separate", slot, 0));
        assertRefused(403, "not-resource-owner", h.plans.acceptChange(h.ctx(), other, "c-p", ORDER, "p", 0));
        assertRefused(404, "not-found", h.plans.read(h.ctx(), PlansHarness.PAULA, "order-missing"));
        assertRefused(403, "role-required", h.plans.read(h.ctx(), new ReturnPlans.Caller("visitor", null), ORDER));
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
        assertEquals(0, h.f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void anUnconfiguredProviderRefusesBeforeWritingAnything() throws Exception {
        h.restart(new UnconfiguredReturnProvider());
        PlanResult.Refused r = refused(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        assertEquals("return-provider-unavailable", r.code());
        assertTrue(r.retryable());
        assertEquals(0, h.f.count("SELECT count(*) FROM return_plans"));
        assertNull(r.plan());
    }
}
