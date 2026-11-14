package gcsp.api.returns;

import static gcsp.api.returns.PlansHarness.EMP;
import static gcsp.api.returns.PlansHarness.HANDOVER_SLOT;
import static gcsp.api.returns.PlansHarness.ORDER;
import static gcsp.api.returns.PlansHarness.assertRefused;
import static gcsp.api.returns.PlansHarness.ok;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Ports the FUCQ-168 outcome tests: only a confirmed return changes the current car. */
class ReturnOutcomesTest {

    static final long DELAY = 1800;
    /** The same-visit slot ends 10:00Z; the policy confirms 1800s after. */
    static final Instant DUE = Instant.parse("2026-11-07T10:30:00Z");

    @TempDir Path dir;
    PlansHarness h;

    @AfterEach
    void tearDown() throws Exception {
        if (h != null) h.close();
    }

    static Consumer<ObjectNode> outcome(String which) {
        return d -> ((ObjectNode) ReturnsFixture.row(d, RetainedReturnPolicy.OUTCOME).get("value")).put("enabled", true)
                .put("outcome", which);
    }

    PlansHarness harness(Consumer<ObjectNode> edit) throws Exception {
        h = new PlansHarness(dir, edit);
        return h;
    }

    /** A scheduled same-visit return under the harness clock. */
    JsonNode schedule() {
        ok(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        h.advance(DELAY);
        assertEquals(1, h.progress(true).applied());
        JsonNode plan = h.plan();
        assertEquals("return-scheduled", plan.path("state").asText());
        return plan;
    }

    void at(Instant when) {
        h.clock.now = when;
    }

    JsonNode keys(JsonNode n) {
        List<String> k = new ArrayList<>();
        n.fieldNames().forEachRemaining(k::add);
        java.util.Collections.sort(k);
        return ReturnJson.JSON.valueToTree(k);
    }

    void assertHeld(JsonNode plan) {
        assertEquals("held", plan.path("relationship").path("oldCar").path("status").asText());
        assertEquals("contract", plan.path("relationship").path("currentCar").path("kind").asText());
    }

    @Test
    void byDefaultNoOutcomeIsReportedSoTheScheduledReturnAndCurrentCarStayAsTheyAre() throws Exception {
        harness(d -> {});
        schedule();
        at(DUE.plusSeconds(3 * 3600));
        for (int i = 0; i < 2; i++) assertEquals(1, h.progress(true).idle());
        JsonNode after = h.plan();
        assertEquals("return-scheduled", after.path("state").asText());
        assertTrue(after.path("scheduled").asBoolean());
        assertTrue(after.path("outcome").isNull());
        assertHeld(after);
        assertEquals(0, h.f.count("SELECT count(*) FROM return_outcomes"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'outcome'"));
    }

    @Test
    void aConfirmedReturnIsRecordedAndOnlyThenChangesTheCurrentCar() throws Exception {
        harness(outcome("returned"));
        JsonNode scheduled = schedule();
        assertHeld(scheduled);
        assertEquals("on-order", scheduled.path("relationship").path("newCar").path("status").asText());

        at(DUE.minusSeconds(60));
        assertEquals(1, h.progress(true).waiting());
        JsonNode early = h.plan();
        assertEquals("return-scheduled", early.path("state").asText());
        assertTrue(early.path("outcome").isNull());
        assertTrue(early.path("pending").isNull());
        assertHeld(early);
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));

        at(DUE.plusSeconds(1));
        ReturnPlans.Summary tick = h.progress(true);
        assertEquals(1, tick.applied());
        JsonNode done = h.plan();
        String when = ReturnJson.format(DUE.plusSeconds(1));
        assertEquals("returned", done.path("state").asText());
        assertFalse(done.path("scheduled").asBoolean());
        assertEquals("retailer", done.path("owner").asText());
        assertEquals("Your current car has been returned. Nothing more is needed from you.", done.path("nextStep").asText());
        JsonNode out = done.path("outcome");
        assertEquals(keys(ReturnJson.JSON.readTree("{\"state\":0,\"at\":0,\"location\":0,\"appointment\":0,"
                + "\"providerReference\":0,\"oldContractId\":0}")), keys(out));
        assertEquals("returned", out.path("state").asText());
        assertEquals(when, out.path("at").asText());
        assertEquals(scheduled.path("location"), out.path("location"));
        assertEquals("contract-1", out.path("oldContractId").asText());
        assertTrue(out.path("providerReference").asText().startsWith("SYN-RET-"));
        JsonNode ap = out.path("appointment");
        assertEquals("return", ap.path("purpose").asText());
        assertEquals(scheduled.path("slot").path("slotId").asText(), ap.path("slotId").asText());
        assertEquals(scheduled.path("slot"), ap.path("slot"));
        assertEquals(scheduled.path("providerReference").asText(), ap.path("providerReference").asText());
        JsonNode last = done.path("history").get(done.path("history").size() - 1);
        assertEquals("returned", last.path("state").asText());
        assertTrue(last.path("appointmentState").isNull());
        assertEquals(when, last.path("at").asText());
        assertEquals(out.path("providerReference"), last.path("providerReference"));

        JsonNode rel = done.path("relationship");
        assertTrue(rel.path("currentCar").isNull(), "returned before the handover: no current car");
        assertEquals("returned", rel.path("oldCar").path("status").asText());
        assertEquals(when, rel.path("oldCar").path("returnedAt").asText());
        assertEquals(out.path("providerReference"), rel.path("oldCar").path("providerReference"));
        assertEquals(scheduled.path("location"), rel.path("oldCar").path("location"));
        assertEquals(1, rel.path("changes").size());
        assertEquals("return-confirmed", rel.path("changes").get(0).path("type").asText());
        boolean assumed = false;
        for (JsonNode a : done.path("assumptions")) {
            assumed |= "lifecycle.return.outcome.v1".equals(a.path("key").asText()) && "assumed".equals(a.path("status").asText());
        }
        assertTrue(assumed);

        // Repeated ticks change nothing; the progress scan no longer selects the plan.
        h.progress(true);
        h.advance(3600);
        ReturnPlans.Summary again = h.progress(true);
        assertEquals(0, again.orders());
        assertEquals(done, h.plan());
        assertEquals(1, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'outcome'"));
        assertEquals(1, h.f.count("SELECT count(*) FROM pending_operations WHERE operation_type = 'return-outcome'"));
        assertEquals("acknowledged", h.f.text("SELECT state FROM pending_operations WHERE operation_type = 'return-outcome'"));
        assertEquals(0, h.f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'return-missed'"));
        assertEquals("true", h.f.text("SELECT outcome_closed::text FROM return_plans WHERE order_uuid = ?", ORDER));

        assertEquals(out, ok(h.plans.read(h.ctx(), ReturnPlans.Caller.greg(), ORDER)).path("outcome"));
        assertEquals(out, ok(h.plans.read(h.ctx(), ReturnPlans.Caller.presenter(), ORDER)).path("outcome"));
        assertRefused(403, "not-resource-owner", h.plans.read(h.ctx(), ReturnPlans.Caller.employee("emp-2"), ORDER));
    }

    @Test
    void aMissedReturnKeepsTheCurrentCarAndEmitsTheReturnMissedException() throws Exception {
        harness(outcome("missed"));
        JsonNode scheduled = schedule();
        at(DUE.plusSeconds(1));
        assertEquals(1, h.progress(true).applied());
        JsonNode missed = h.plan();
        String when = ReturnJson.format(DUE.plusSeconds(1));
        assertEquals("return-missed", missed.path("state").asText());
        assertFalse(missed.path("scheduled").asBoolean());
        assertEquals("scheme-team", missed.path("owner").asText());
        assertEquals("The scheme team will contact you to rearrange the return of your current car.", missed.path("nextStep").asText());
        assertEquals("return-missed", missed.path("outcome").path("state").asText());
        assertEquals(when, missed.path("outcome").path("at").asText());
        assertEquals(scheduled.path("location"), missed.path("outcome").path("location"));
        assertHeld(missed);
        assertEquals(0, missed.path("relationship").path("changes").size());
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertEquals(1, h.f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'return-missed'"));
        JsonNode e = ReturnJson.JSON.readTree(h.f.text("SELECT payload::text FROM outbox_events WHERE event_type = 'return-missed'"));
        assertEquals(EMP, e.path("employeeId").asText());
        assertEquals(ORDER, e.path("orderUuid").asText());
        assertEquals(when, e.path("occurredAt").asText());
        assertEquals("return-missed", e.path("exceptionType").asText());
        assertEquals("contract-1", e.path("oldContractId").asText());
        assertEquals("slot-ent-1", e.path("entitlementSlotId").asText());
        assertEquals("not-read", e.path("renewalAuthority").asText());
        assertEquals("test-policy-v1", e.path("policyVersion").asText());
        assertTrue(e.path("fictional").asBoolean());
        assertEquals(scheduled.path("providerReference").asText(), e.path("appointment").path("providerReference").asText());
        assertEquals(missed.path("outcome").path("providerReference"), e.path("providerReference"));
        h.progress(true);
        assertEquals(1, h.f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'return-missed'"));
    }

    @Test
    void recordedReturnedAndMissedReadModelsKeepTheScheduledShape() throws Exception {
        for (String which : new String[] {"returned", "missed"}) {
            if (h != null) h.close();
            harness(outcome(which));
            JsonNode scheduled = schedule();
            at(DUE.plusSeconds(1));
            h.progress(true);
            JsonNode done = h.plan();
            assertEquals(keys(scheduled), keys(done), which);
            assertEquals("same-visit", done.path("choice").asText());
            assertEquals(List.of("return-requested", "return-scheduled", which.equals("returned") ? "returned" : "return-missed"),
                    states(done.path("history")));
            assertEquals(keys(ReturnJson.JSON.readTree("{\"purpose\":0,\"slotId\":0,\"slot\":0,\"providerReference\":0}")),
                    keys(done.path("outcome").path("appointment")));
            assertEquals(which.equals("returned") ? "returned" : "held", done.path("relationship").path("oldCar").path("status").asText());
            assertEquals(which.equals("returned") ? null : "contract",
                    done.path("relationship").path("currentCar").path("kind").asText(null));
        }
    }

    List<String> states(JsonNode history) {
        List<String> out = new ArrayList<>();
        history.forEach(n -> out.add(n.path("state").asText()));
        return out;
    }

    @Test
    void anUncertainOutcomeStaysPendingAndReconcilesAfterARestartWithOneReceipt() throws Exception {
        harness(outcome("returned"));
        schedule();
        at(DUE.plusSeconds(1));
        h.provider.failOnce(FlakyReturnProvider.Fault.THROW_BEFORE);
        ReturnPlans.Summary first = h.progress(true);
        assertEquals(1, first.uncertain());
        JsonNode unsure = h.plan();
        assertEquals("return-scheduled", unsure.path("state").asText());
        assertEquals("outcome", unsure.path("pending").path("step").asText());
        assertEquals(PlanView.WAITING, unsure.path("pending").path("reason").asText());
        assertEquals("scheme-team", unsure.path("owner").asText());
        assertHeld(unsure);
        assertEquals(0, h.f.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'outcome'"));
        assertEquals("pending", h.f.text("SELECT state FROM pending_operations WHERE operation_type = 'return-outcome'"));

        FlakyReturnProvider fresh = new FlakyReturnProvider(new SyntheticReturnProvider(h.f.pool()));
        h.restart(fresh);
        ReturnPlans.Summary startup = h.progress(false);
        assertEquals(1, startup.waiting());
        assertEquals(0, fresh.writes.get(), "startup writes nothing to the provider");
        assertEquals("return-scheduled", h.plan().path("state").asText());

        assertEquals(1, h.progress(true).applied());
        assertEquals(1, fresh.writes.get());
        JsonNode done = h.plan();
        assertEquals("returned", done.path("state").asText());
        assertTrue(done.path("pending").isNull());
        assertEquals("returned", done.path("relationship").path("oldCar").path("status").asText());
        assertEquals(1, h.f.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'outcome'"));
        assertEquals(1, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals("2", h.f.text("SELECT attempts::text FROM pending_operations WHERE operation_type = 'return-outcome'"));
    }

    @Test
    void theLiveStubBlocksTheOutcomeAndChangesNothing() throws Exception {
        harness(outcome("returned"));
        schedule();
        at(DUE.plusSeconds(1));
        h.restart(new LiveReturnProviderStub());
        assertEquals(1, h.progress(true).blocked());
        JsonNode live = h.plan();
        assertEquals("return-scheduled", live.path("state").asText());
        assertEquals(LiveReturnProviderStub.OUTCOMES_CODE, live.path("blocked").path("code").asText());
        assertEquals("scheme-team", live.path("owner").asText());
        assertTrue(live.path("outcome").isNull());
        assertHeld(live);
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals(0, h.f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'return-missed'"));
        assertEquals("refused", h.f.text("SELECT state FROM pending_operations WHERE operation_type = 'return-outcome'"));
        assertEquals(0, h.progress(true).orders(), "a blocked outcome leaves the progress scan");
    }

    @Test
    void aCurrentCarRefusalRollsBackTheSettleAndLeavesTheOutcomeAwaiting() throws Exception {
        harness(outcome("returned"));
        schedule();
        at(DUE.plusSeconds(1));
        ReturnSource good = InMemoryReturnSource.replacement(ORDER, EMP);
        h.source.put(new ReturnSource(ORDER, EMP, true, "contract-2", good.entitlementSlotId(), good.oldSlotId(),
                good.locationId(), false, good.mileage(), good.mileageUnit(), good.sourceReference(), good.receivedAt(),
                good.configurationId()));
        ReturnPlans.Summary bad = h.progress(true);
        assertEquals(1, bad.failed().size());
        assertEquals(0, bad.applied());
        assertEquals("awaiting", h.f.text("SELECT state FROM return_outcomes WHERE order_uuid = ?", ORDER));
        assertEquals("intent", h.f.text("SELECT state FROM pending_operations WHERE operation_type = 'return-outcome'"));
        assertEquals("false", h.f.text("SELECT outcome_closed::text FROM return_plans WHERE order_uuid = ?", ORDER));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_events"));
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));

        h.source.put(good);
        assertEquals(1, h.progress(true).applied());
        assertEquals("returned", h.plan().path("state").asText());
        assertEquals(1, h.f.count("SELECT count(*) FROM current_car_events"));
    }

    @Test
    void aRequestedOrAcceptedPlanNeverChangesTheCurrentCar() throws Exception {
        harness(outcome("returned"));
        ok(h.request("c-1", "same-visit", HANDOVER_SLOT.slotId(), 0));
        at(DUE.plusSeconds(1));
        h.progress(true);
        assertEquals(0, h.f.count("SELECT count(*) FROM current_car_relationships"));
        assertNotNull(h.plan());
        assertNull(h.f.text("SELECT provider_reference FROM return_outcomes WHERE order_uuid = ?", ORDER));
    }
}
