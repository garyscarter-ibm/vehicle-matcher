package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHarness.DELAY;
import static gcsp.api.appointments.ApptHarness.ORDER;
import static gcsp.api.appointments.ApptHarness.assertConflict;
import static gcsp.api.appointments.ApptHarness.ok;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

class AppointmentServiceTest {

    static final List<String> KEYS = List.of("contractVersion", "runId", "orderUuid", "employeeId", "version", "state",
            "booked", "slot", "requestedSlot", "proposedSlot", "proposalId", "history", "owner", "nextStep", "pending",
            "blocked", "offeredSlots", "eligibility", "policyVersion", "assumptions", "provider", "fictional", "outcome");

    static ApptHarness proposing() throws Exception {
        return ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.scenario.v1").put("proposeChange", true));
    }

    static ApptHarness shortTimeout() throws Exception {
        return ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.confirmation.v1").put("providerTimeoutMs", 50));
    }

    static List<String> keys(JsonNode n) {
        List<String> out = new ArrayList<>();
        n.fieldNames().forEachRemaining(out::add);
        return sorted(out);
    }

    static List<String> sorted(List<String> in) {
        return new TreeSet<>(in).stream().toList();
    }

    @Test
    void refusedUntilSentToOrderingThenSlotsFollowPolicy() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            assertInstanceOf(AppointmentResult.NotFound.class, h.readResult(h.paula, "no-such-order"));
            h.stages.order(ORDER, "employee-paula", 3);
            JsonNode early = h.read(h.paula);
            assertEquals("not-requested", early.get("state").asText());
            assertFalse(early.get("booked").asBoolean());
            assertFalse(early.get("eligibility").get("eligible").asBoolean());
            assertEquals(0, early.get("offeredSlots").size());
            assertEquals("scheme-team", early.get("owner").asText());
            assertEquals("Waiting for your order to be sent to ordering.", early.get("nextStep").asText());
            AppointmentResult.Conflict c = assertInstanceOf(AppointmentResult.Conflict.class,
                    h.request(h.paula, "slot-20261107T0900Z", 0));
            assertEquals("appointment-not-eligible", c.code());
            assertEquals(0, h.count("SELECT count(*) FROM appointments"));
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations"));

            h.stages.order(ORDER, "employee-paula", 4);
            JsonNode open = h.read(h.paula);
            assertTrue(open.get("eligibility").get("eligible").asBoolean());
            assertEquals(6, open.get("offeredSlots").size());
            assertEquals("2026-11-07T09:00:00.000Z", open.get("offeredSlots").get(0).get("start").asText());
            assertEquals("2026-11-07T10:00:00.000Z", open.get("offeredSlots").get(0).get("end").asText());
            assertEquals("employee", open.get("owner").asText());
            assertEquals("Choose a handover slot.", open.get("nextStep").asText());
            assertEquals(0, open.get("version").asLong());
            assertTrue(open.get("fictional").asBoolean());
            assertEquals("synthetic", open.get("provider").get("mode").asText());

            AppointmentResult.Invalid notOffered = assertInstanceOf(AppointmentResult.Invalid.class,
                    h.request(h.paula, "slot-nope", 0));
            assertEquals("slotId", notOffered.reasons().get(0).field());
            AppointmentResult.Invalid extra = assertInstanceOf(AppointmentResult.Invalid.class, h.service.request(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("commandId", "c").put("orderUuid", ORDER)
                            .put("slotId", h.firstSlot()).put("expectedVersion", 0).put("employeeId", "employee-alex")));
            assertEquals("employeeId", extra.reasons().get(0).field());
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.read(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER).put("runId", "other")));
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.request(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("commandId", "c").put("orderUuid", ORDER).put("expectedVersion", 0)));
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.request(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER).put("slotId", h.firstSlot())));
            assertEquals(0, h.count("SELECT count(*) FROM appointments"));
        }
        try (ApptHarness h = ApptHarness.create(false, d -> {
            var v = ApptHarness.value(d, "lifecycle.appointments.slots.v1");
            v.put("earliestLeadDays", 3).put("daysOffered", 2).put("slotMinutes", 30);
            v.putArray("dailyStartTimes").add("10:00");
        })) {
            List<JsonNode> slots = h.offered();
            assertEquals(2, slots.size());
            assertEquals("2026-11-08T10:00:00.000Z", slots.get(0).get("start").asText());
            assertEquals("2026-11-08T10:30:00.000Z", slots.get(0).get("end").asText());
        }
    }

    @Test
    void requestedIsNeverBookedAndConfirmationWaitsForTheDelay() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            JsonNode slot = h.offered().get(0);
            JsonNode made = ok(h.request(h.paula, slot.get("slotId").asText(), 0));
            assertEquals("requested", made.get("state").asText());
            assertFalse(made.get("booked").asBoolean());
            assertTrue(made.get("slot").isNull());
            assertEquals(slot, made.get("requestedSlot"));
            assertTrue(made.get("pending").isNull());
            assertTrue(made.get("blocked").isNull());
            assertEquals(0, made.get("offeredSlots").size());
            assertEquals(2, made.get("version").asLong());
            assertEquals("retailer", made.get("owner").asText());
            assertEquals("Waiting for the retailer to confirm your slot.", made.get("nextStep").asText());
            assertEquals(1, made.get("history").size());
            assertEquals("requested", made.get("history").get(0).get("state").asText());
            assertEquals("2026-11-05T09:00:00.000Z", made.get("history").get(0).get("at").asText());
            assertTrue(made.get("history").get(0).get("providerReference").asText().matches("SYN-APT-[0-9A-F]{12}"));

            assertEquals(1, h.tick().get("orders").asInt());
            h.advance(DELAY - 1);
            assertEquals(1, h.tick().get("waiting").asInt());
            JsonNode view = h.read(h.paula);
            assertEquals("requested", view.get("state").asText());
            assertFalse(view.get("booked").asBoolean());
            assertEquals(1, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));

            h.advance(1);
            Instant confirmedAt = h.now;
            JsonNode summary = h.tick();
            assertEquals(1, summary.get("applied").asInt());
            assertEquals(0, summary.get("failed").size());
            view = h.read(h.paula);
            assertEquals("scheduled", view.get("state").asText());
            assertTrue(view.get("booked").asBoolean());
            assertEquals(slot, view.get("slot"));
            assertEquals("The retailer prepares your car for the handover.", view.get("nextStep").asText());
            assertEquals(2, view.get("history").size());
            assertEquals(Instant.parse("2026-11-05T09:00:00Z"), Instant.parse(view.get("history").get(0).get("at").asText()));
            assertEquals(confirmedAt, Instant.parse(view.get("history").get(1).get("at").asText()));
            assertEquals("scheduled", view.get("history").get(1).get("state").asText());
            assertTrue(view.get("history").get(1).get("providerReference").asText().startsWith("SYN-APT-"));
            assertFalse(view.get("history").get(0).get("providerReference").asText()
                    .equals(view.get("history").get(1).get("providerReference").asText()));
            h.tick();
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertEquals(1, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'confirm'"));
            assertEquals(3, h.provider.count("confirm"), "two in-progress asks record nothing, the third schedules");
            assertEquals(1, h.provider.count("request"));
        }
    }

    @Test
    void repeatsConflictsAndVersions() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            List<JsonNode> slots = h.offered();
            String first = slots.get(0).get("slotId").asText();
            String second = slots.get(1).get("slotId").asText();
            JsonNode made = ok(h.request(h.paula, ORDER, first, 0, "cmd-a"));
            long receipts = h.count("SELECT count(*) FROM command_receipts");
            JsonNode again = ok(h.request(h.paula, ORDER, first, 2, "cmd-b"));
            assertEquals(made, again);
            assertEquals(receipts, h.count("SELECT count(*) FROM command_receipts"));
            assertEquals(1, h.count("SELECT count(*) FROM pending_operations"));
            assertEquals(1, h.provider.count("request"));
            assertConflict("appointment-already-requested", h.request(h.paula, ORDER, second, 2, "cmd-c"));
            assertEquals(made, ok(h.request(h.paula, ORDER, first, 0, "cmd-a")));
            assertConflict("command-input-changed", h.request(h.paula, ORDER, second, 0, "cmd-a"));
        }
        try (ApptHarness h = ApptHarness.create()) {
            AppointmentResult.Conflict stale = assertInstanceOf(AppointmentResult.Conflict.class, h.request(h.paula, h.firstSlot(), 3));
            assertEquals("stale-version", stale.code());
            assertEquals(0, stale.extra().get("currentVersion").asLong());
            assertEquals(0, h.count("SELECT count(*) FROM appointments"));
        }
    }

    @Test
    void acceptWithAStaleVersionReportsTheCurrentVersion() throws Exception {
        try (ApptHarness h = proposing()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.tick();
            JsonNode view = h.read(h.paula);
            assertEquals("change-proposed", view.get("state").asText());
            long version = view.get("version").asLong();
            AppointmentResult.Conflict stale = assertInstanceOf(AppointmentResult.Conflict.class,
                    h.accept(h.paula, view.get("proposalId").asText(), version + 5));
            assertEquals("stale-version", stale.code());
            assertEquals(version, stale.extra().get("currentVersion").asLong());
            assertEquals("change-proposed", h.read(h.paula).get("state").asText());
        }
    }

    @Test
    void proposedChangeNeedsTheEmployeesAcceptance() throws Exception {
        try (ApptHarness h = proposing()) {
            assertInstanceOf(AppointmentResult.NotFound.class, h.accept(h.paula, "x", 0));
            JsonNode slot = h.offered().get(0);
            ok(h.request(h.paula, h.firstSlot(), 0));
            assertConflict("no-change-proposed", h.accept(h.paula, "x", 2));
            h.advance(DELAY);
            h.tick();
            JsonNode view = h.read(h.paula);
            assertEquals("change-proposed", view.get("state").asText());
            assertFalse(view.get("booked").asBoolean());
            assertTrue(view.get("slot").isNull());
            assertEquals("employee", view.get("owner").asText());
            assertEquals("Accept the new time to confirm your handover.", view.get("nextStep").asText());
            assertFalse(view.get("proposedSlot").get("slotId").asText().equals(slot.get("slotId").asText()));
            assertTrue(view.get("proposedSlot").get("start").asText().compareTo(slot.get("start").asText()) > 0);
            assertEquals("change-proposed", view.get("history").get(1).get("state").asText());
            h.advance(DELAY);
            h.tick();
            h.tick();
            assertEquals("change-proposed", h.read(h.paula).get("state").asText());
            assertEquals(0, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'accept'"));

            String proposalId = view.get("proposalId").asText();
            long version = view.get("version").asLong();
            assertInstanceOf(AppointmentResult.Forbidden.class, h.accept(h.alex, proposalId, version));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.accept(h.greg, proposalId, version));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.accept(h.presenter, proposalId, version));
            assertInstanceOf(AppointmentResult.Invalid.class, h.accept(h.paula, "other", version));
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.acceptChange(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("commandId", "c").put("orderUuid", ORDER).put("proposalId", proposalId)
                            .put("expectedVersion", version).put("runId", "r")));
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.acceptChange(h.paula, h.run,
                    ApptFixture.JSON.createObjectNode().put("commandId", "c").put("orderUuid", ORDER).put("expectedVersion", version)));
            JsonNode accepted = ok(h.accept(h.paula, proposalId, version, "accept-1"));
            assertEquals("scheduled", accepted.get("state").asText());
            assertTrue(accepted.get("booked").asBoolean());
            assertEquals(view.get("proposedSlot").get("slotId").asText(), accepted.get("slot").get("slotId").asText());
            assertEquals(List.of("requested", "change-proposed", "scheduled"), accepted.get("history").findValuesAsText("state"));
            JsonNode repeat = ok(h.accept(h.paula, proposalId, version + 2, "accept-2"));
            assertEquals("scheduled", repeat.get("state").asText());
            assertEquals(accepted, ok(h.accept(h.paula, proposalId, version, "accept-1")));
            assertEquals(3, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertEquals(1, h.provider.count("accept"));
        }
    }

    @Test
    void liveStubIsBlockedAndWritesNothing() throws Exception {
        try (ApptHarness h = ApptHarness.live()) {
            JsonNode view = h.read(h.paula);
            assertEquals(0, view.get("offeredSlots").size());
            assertEquals("live-appointments-unsupported", view.get("blocked").get("code").asText());
            assertEquals("scheme-team", view.get("owner").asText());
            assertEquals("live", view.get("provider").get("mode").asText());
            assertFalse(view.get("provider").get("synthetic").asBoolean());
            assertFalse(view.get("fictional").asBoolean());
            AppointmentResult.Unsupported u = assertInstanceOf(AppointmentResult.Unsupported.class,
                    h.request(h.paula, "slot-20261107T0900Z", 0));
            assertEquals("live-appointments-unsupported", u.code());
            assertEquals(LiveAppointmentsStub.REASON, u.reason());
            assertNull(u.appointment());
            h.advance(DELAY);
            h.tick();
            assertEquals(0, h.count("SELECT count(*) FROM appointments"));
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations"));
            assertEquals(0, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    static void refuse(ApptHarness h, String step, String reason) {
        h.provider.fault.put(step, new ProviderAnswer.Unsupported("live-appointments-unsupported", reason));
    }

    @Test
    void aRefusedRequestShowsWhyAndIsNeverRetried() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            String slotId = h.firstSlot();
            refuse(h, "request", "Booking is not connected.");
            AppointmentResult.Unsupported blocked = assertInstanceOf(AppointmentResult.Unsupported.class, h.request(h.paula, slotId, 0));
            assertEquals("live-appointments-unsupported", blocked.code());
            assertEquals("Booking is not connected.", blocked.reason());
            JsonNode a = blocked.appointment();
            assertEquals("not-requested", a.get("state").asText());
            assertFalse(a.get("booked").asBoolean());
            assertEquals("Booking is not connected.", a.get("blocked").get("reason").asText());
            assertEquals("scheme-team", a.get("owner").asText());
            assertTrue(a.get("pending").isNull());
            assertEquals(0, h.count("SELECT count(*) FROM appointment_history"));
            assertEquals("refused", h.fx.stringOf("SELECT state FROM pending_operations"));
            assertEquals(0, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            h.advance(DELAY);
            h.tick();
            assertEquals("not-requested", h.read(h.paula).get("state").asText());
            assertEquals(1, h.provider.count("request"));
            JsonNode repeat = ok(h.request(h.paula, ORDER, slotId, 2, "again"));
            assertEquals("not-requested", repeat.get("state").asText());
            assertEquals("live-appointments-unsupported", repeat.get("blocked").get("code").asText());
            assertEquals(1, h.provider.count("request"));
        }
        try (ApptHarness h = proposing()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.tick();
            JsonNode view = h.read(h.paula);
            String proposal = view.get("proposalId").asText();
            refuse(h, "accept", "Acceptance is not connected.");
            AppointmentResult.Unsupported stuck = assertInstanceOf(AppointmentResult.Unsupported.class,
                    h.accept(h.paula, proposal, view.get("version").asLong()));
            assertEquals("Acceptance is not connected.", stuck.reason());
            assertEquals("change-proposed", stuck.appointment().get("state").asText());
            assertFalse(stuck.appointment().get("booked").asBoolean());
            AppointmentResult.Unsupported again = assertInstanceOf(AppointmentResult.Unsupported.class,
                    h.accept(h.paula, proposal, view.get("version").asLong() + 1, "later"));
            assertEquals("Acceptance is not connected.", again.reason());
            assertEquals(1, h.provider.count("accept"));
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void uncertainConfirmStaysPendingThenReconcilesWithoutASecondConfirm() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "throw-after");
            h.tick();
            String opId = AppointmentIds.operationId("run-1", ORDER, "confirm");
            assertEquals("pending", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", opId));
            JsonNode view = h.read(h.paula);
            assertEquals("requested", view.get("state").asText());
            assertFalse(view.get("booked").asBoolean());
            assertEquals("confirm", view.get("pending").get("step").asText());
            assertEquals("scheme-team", view.get("owner").asText());
            assertEquals("Waiting for the scheme team to confirm the last update.", view.get("nextStep").asText());
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            h.provider.calls.clear();
            h.tick();
            assertEquals(List.of("reconcile"), h.provider.calls);
            view = h.read(h.paula);
            assertEquals("scheduled", view.get("state").asText());
            assertTrue(view.get("pending").isNull());
            assertEquals("acknowledged", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", opId));
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void aLostConfirmIsReconciledNotFoundThenRetriedOnce() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "lost");
            h.tick();
            assertEquals("confirm", h.read(h.paula).get("pending").get("step").asText());
            h.provider.calls.clear();
            h.tick();
            assertEquals(List.of("reconcile", "confirm"), h.provider.calls);
            assertEquals("scheduled", h.read(h.paula).get("state").asText());
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertEquals(1, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'confirm'"));
        }
    }

    @Test
    void aHangOrGarbledAnswerStaysPendingAndIsNeverBooked() throws Exception {
        try (ApptHarness h = shortTimeout()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "hang");
            h.tick();
            JsonNode view = h.read(h.paula);
            assertFalse(view.get("booked").asBoolean());
            assertEquals("confirm", view.get("pending").get("step").asText());
            h.provider.fault.put("reconcile", "garbled");
            h.tick();
            view = h.read(h.paula);
            assertFalse(view.get("booked").asBoolean());
            assertEquals("confirm", view.get("pending").get("step").asText());
            h.tick();
            assertEquals("scheduled", h.read(h.paula).get("state").asText());
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void anUncertainRequestAndAcceptReconcileOnTheNextTickWithoutASecondWrite() throws Exception {
        try (ApptHarness h = proposing()) {
            h.provider.fault.put("request", "throw-after");
            JsonNode made = ok(h.request(h.paula, h.firstSlot(), 0));
            assertEquals("not-requested", made.get("state").asText());
            assertFalse(made.get("booked").asBoolean());
            assertEquals("request", made.get("pending").get("step").asText());
            assertEquals("scheme-team", made.get("owner").asText());
            h.provider.calls.clear();
            h.tick();
            assertEquals(List.of("reconcile"), h.provider.calls);
            JsonNode view = h.read(h.paula);
            assertEquals("requested", view.get("state").asText());
            assertTrue(view.get("pending").isNull());
            h.advance(DELAY);
            h.tick();
            view = h.read(h.paula);
            String proposal = view.get("proposalId").asText();
            h.provider.fault.put("accept", "throw-after");
            JsonNode pending = ok(h.accept(h.paula, proposal, view.get("version").asLong()));
            assertEquals("change-proposed", pending.get("state").asText());
            assertFalse(pending.get("booked").asBoolean());
            assertEquals("accept", pending.get("pending").get("step").asText());
            assertEquals("accept", ok(h.accept(h.paula, proposal, pending.get("version").asLong(), "again"))
                    .get("pending").get("step").asText());
            assertEquals(1, h.provider.count("accept"));
            h.provider.calls.clear();
            h.tick();
            assertEquals(List.of("reconcile"), h.provider.calls);
            view = h.read(h.paula);
            assertEquals("scheduled", view.get("state").asText());
            assertTrue(view.get("booked").asBoolean());
            assertEquals(3, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void identityAndOwnership() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            String slot = h.firstSlot();
            assertInstanceOf(AppointmentResult.Forbidden.class, h.readResult(h.alex, ORDER));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.request(h.alex, slot, 0));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.request(h.greg, slot, 0));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.request(h.presenter, slot, 0));
            assertEquals(0, h.count("SELECT count(*) FROM appointments"));
            ok(h.request(h.paula, slot, 0));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.readResult(h.alex, ORDER));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.request(h.alex, slot, 2));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.accept(h.alex, "x", 2));
            for (Principal who : List.of(h.greg, h.presenter)) {
                JsonNode v = h.read(who);
                assertEquals("requested", v.get("state").asText());
                assertEquals("employee-paula", v.get("employeeId").asText());
                assertInstanceOf(AppointmentResult.Forbidden.class, h.accept(who, "x", 2));
            }
            assertInstanceOf(AppointmentResult.Forbidden.class, h.service.recordTick(h.paula, h.run, "t-x", h.now));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.service.tick(h.greg, h.run, h.now));
        }
    }

    @Test
    void startupReconcileOnlyReconciles() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            JsonNode s = ok(h.service.reconcileOnStartup(h.run));
            assertEquals(0, s.get("orders").asInt());
            assertEquals("requested", h.read(h.paula).get("state").asText());
            assertEquals(0, h.provider.count("confirm"));
            h.tick();
            assertEquals("scheduled", h.read(h.paula).get("state").asText());
        }
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "throw-after");
            h.tick();
            h.provider.calls.clear();
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals("scheduled", h.read(h.paula).get("state").asText());
            assertEquals(List.of("reconcile"), h.provider.calls);
        }
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "lost");
            h.tick();
            h.provider.calls.clear();
            ok(h.service.reconcileOnStartup(h.run));
            JsonNode view = h.read(h.paula);
            assertEquals("requested", view.get("state").asText());
            assertEquals("confirm", view.get("pending").get("step").asText());
            assertEquals(List.of("reconcile"), h.provider.calls);
            h.tick();
            assertEquals("scheduled", h.read(h.paula).get("state").asText());
        }
    }

    @Test
    void aRestartReadsTheSameStateAndReconcilesAPendingOperationWithoutReinventingIt() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "throw-after");
            h.tick();
            JsonNode before = h.read(h.paula);
            long inputs = h.count("SELECT count(*) FROM appointment_operation_inputs");
            h.start();
            assertEquals(before, h.read(h.paula));
            assertEquals("confirm", before.get("pending").get("step").asText());
            assertEquals(1, before.get("history").size());
            h.tick();
            assertEquals(List.of("reconcile"), h.provider.calls);
            JsonNode after = h.read(h.paula);
            assertEquals("scheduled", after.get("state").asText());
            assertEquals(inputs, h.count("SELECT count(*) FROM appointment_operation_inputs"));
            assertEquals(2, h.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertEquals(2, after.get("history").size());
        }
    }

    @Test
    void ticksNeverGoBackwardsAndReplay() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            Instant later = h.now.plusSeconds(600);
            ok(h.service.recordTick(h.presenter, h.run, "tick-late", later));
            AppointmentResult.Conflict back = assertInstanceOf(AppointmentResult.Conflict.class,
                    h.service.recordTick(h.presenter, h.run, "tick-early", later.minusSeconds(1)));
            assertEquals("clock-backwards", back.code());
            long ticks = h.count("SELECT count(*) FROM appointment_ticks");
            ok(h.service.recordTick(h.presenter, h.run, "tick-late", later));
            assertEquals(ticks, h.count("SELECT count(*) FROM appointment_ticks"));
            assertConflict("command-input-changed", h.service.recordTick(h.presenter, h.run, "tick-late", later.plusSeconds(1)));
            assertEquals(later, new TickClock(h.pool).now(h.run).orElseThrow());
            ok(h.service.recordTick(h.presenter, h.run, "tick-same", later));
            assertEquals(ticks + 1, h.count("SELECT count(*) FROM appointment_ticks"));
        }
    }

    @Test
    void noClockOrNoProviderIsUnavailableNeverTheWallClockOrSynthetic() throws Exception {
        try (ApptFixture fx = ApptFixture.create()) {
            StubStages stages = new StubStages();
            stages.order(ORDER, "employee-paula", 4);
            Path dir = Files.createTempDirectory("appt-");
            try {
                Path file = dir.resolve("policy.json");
                Files.writeString(file, ApptFixture.resource("policy.json").toString());
                Principal paula = new Principal("s", List.of("employee"), "test-env", "run-1", "employee-paula",
                        "gcsp-policy-v1", List.of());
                var input = ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER);
                try (AppointmentService s = new AppointmentService(fx.pool(), new RetainedFileAppointmentPolicy(file),
                        new SyntheticAppointments(fx.pool()), stages, new TickClock(fx.pool()))) {
                    AppointmentResult.Unavailable u = assertInstanceOf(AppointmentResult.Unavailable.class,
                            s.read(paula, fx.ctx(), input));
                    assertEquals("appointments-clock-unavailable", u.code());
                }
                try (AppointmentService s = new AppointmentService(fx.pool(), new UnconfiguredAppointmentPolicy(),
                        new UnconfiguredAppointments(), stages, new TickClock(fx.pool()))) {
                    AppointmentResult.Unavailable u = assertInstanceOf(AppointmentResult.Unavailable.class,
                            s.read(paula, fx.ctx(), input));
                    assertEquals("appointments-provider-not-configured", u.code());
                    assertFalse(u.retryable());
                }
            } finally {
                Files.deleteIfExists(dir.resolve("policy.json"));
                Files.deleteIfExists(dir);
            }
        }
    }

    @Test
    void runsAreIsolated() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.fx.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
            h.fx.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-2', 'active')", ApptFixture.ENV);
            RunContext other = new RunContext(ApptFixture.ENV, "run-2", "caller");
            ok(h.service.recordTick(h.presenter, other, "t-1", h.now));
            JsonNode view = ok(h.service.read(h.paula, other, ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER)));
            assertEquals("not-requested", view.get("state").asText());
            assertEquals("run-2", view.get("runId").asText());
            assertEquals(0, view.get("version").asLong());
            assertEquals(0, ok(h.service.tick(h.presenter, other, h.now)).get("orders").asInt());
            assertEquals(1, h.count("SELECT count(*) FROM appointments WHERE run_id = 'run-1'"));
            assertEquals(0, h.count("SELECT count(*) FROM appointments WHERE run_id = 'run-2'"));
        }
    }

    @Test
    void readModelShapesMatchTheRecordedKeysAndPolicyValues() throws Exception {
        try (ApptHarness h = shortTimeout()) {
            List<String> want = sorted(KEYS);
            JsonNode notRequested = h.read(h.paula);
            assertEquals(want, keys(notRequested));
            owner(notRequested, "employee", "Choose a handover slot.");
            JsonNode requested = ok(h.request(h.paula, h.firstSlot(), 0));
            assertEquals(want, keys(requested));
            owner(requested, "retailer", "Waiting for the retailer to confirm your slot.");
            assertEquals(sorted(List.of("state", "at", "providerReference")), keys(requested.get("history").get(0)));
            assertEquals(sorted(List.of("slotId", "start", "end")), keys(requested.get("requestedSlot")));
            h.advance(DELAY);
            h.provider.fault.put("confirm", "hang");
            h.tick();
            JsonNode pending = h.read(h.paula);
            assertEquals(want, keys(pending));
            owner(pending, "scheme-team", "Waiting for the scheme team to confirm the last update.");
            assertEquals(sorted(List.of("step", "reason")), keys(pending.get("pending")));
            assertEquals("Waiting for the provider to confirm the last update.", pending.get("pending").get("reason").asText());
            h.tick();
            JsonNode scheduled = h.read(h.paula);
            assertEquals(want, keys(scheduled));
            owner(scheduled, "retailer", "The retailer prepares your car for the handover.");
            assertEquals(5, scheduled.get("assumptions").size());
            assertEquals(sorted(List.of("key", "status", "unit", "basis", "source", "sourceDate", "policyVersion")),
                    keys(scheduled.get("assumptions").get(0)));
            assertEquals("lifecycle.appointments.v1", scheduled.get("contractVersion").asText());
            assertEquals("gcsp-policy-v1", scheduled.get("policyVersion").asText());
            assertTrue(scheduled.get("outcome").isNull());
            assertEquals(sorted(List.of("eligible", "code", "reason")), keys(scheduled.get("eligibility")));
        }
        try (ApptHarness h = proposing()) {
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(DELAY);
            h.tick();
            JsonNode proposed = h.read(h.paula);
            assertEquals(sorted(KEYS), keys(proposed));
            owner(proposed, "employee", "Accept the new time to confirm your handover.");
            assertEquals(sorted(List.of("slotId", "start", "end")), keys(proposed.get("proposedSlot")));
        }
    }

    private static void owner(JsonNode v, String owner, String nextStep) {
        assertEquals(owner, v.get("owner").asText());
        assertEquals(nextStep, v.get("nextStep").asText());
        assertFalse(v.get("nextStep").asText().contains("—"));
    }

    @Test
    void aRequestIssuesAFixedNumberOfStatementsWhateverElseExists() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            int baseline = statementsForRequest(h, 0);
            for (int i = 0; i < 50; i++) {
                h.fx.update("INSERT INTO appointments (environment_id, run_id, order_uuid, employee_id, state, policy_version, "
                        + "provider_mode, opening, confirmation, requested_slot, slot) VALUES (?, 'run-1', ?, 'employee-x', "
                        + "'scheduled', 'gcsp-policy-v1', 'synthetic', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)",
                        ApptFixture.ENV, "other-" + i);
            }
            int crowded = statementsForRequest(h, 1);
            assertEquals(baseline, crowded, "a request's statement count does not depend on how many appointments exist");
            String plan = h.fx.plan("SELECT order_uuid FROM appointments WHERE environment_id = 'test-env' AND run_id = 'run-1' "
                    + "AND order_uuid > '' AND (state = 'requested' OR pending_step IS NOT NULL) ORDER BY order_uuid LIMIT 100");
            assertTrue(plan.contains("appointments_actionable"), plan);
            assertEquals(2, h.tick().get("orders").asInt(), "only the two requested appointments are visited");
        }
    }

    private int statementsForRequest(ApptHarness h, int n) {
        String order = n == 0 ? ORDER : "second-order";
        if (n == 1) h.stages.order(order, "employee-paula", 4);
        String slotId = ok(h.service.read(h.paula, h.run, ApptFixture.JSON.createObjectNode().put("orderUuid", order)))
                .get("offeredSlots").get(0).get("slotId").asText();
        h.statements.set(0);
        ok(h.request(h.paula, order, slotId, 0, "count-" + n));
        return h.statements.get();
    }
}
