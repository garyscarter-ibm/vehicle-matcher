package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHarness.ORDER;
import static gcsp.api.appointments.ApptHarness.assertConflict;
import static gcsp.api.appointments.ApptHarness.ok;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The handover no-show outcome (greg only, policy timed, exception event in the same commit) and rebooking after it. */
class AppointmentNoShowTest {

    static final String OP = AppointmentIds.operationId("run-1", ORDER, "no-show");

    static ApptHarness scheduledAtSlot() throws Exception {
        ApptHarness h = ApptHarness.create();
        AppointmentCompletionTest.clockAtSlot(h, AppointmentCompletionTest.scheduled(h), 0);
        return h;
    }

    /** A zero lead time puts the missed slot back in the offer, so the missed-slot filter has something to remove. */
    static ApptHarness sameDayOffers(int providerTimeoutMs) throws Exception {
        ApptHarness h = ApptHarness.create(false, d -> {
            ApptHarness.value(d, "lifecycle.appointments.slots.v1").put("earliestLeadDays", 0);
            ApptHarness.value(d, "lifecycle.appointments.confirmation.v1").put("providerTimeoutMs", providerTimeoutMs);
        });
        AppointmentCompletionTest.clockAtSlot(h, AppointmentCompletionTest.scheduled(h), 3600);
        return h;
    }

    static AppointmentResult noShow(ApptHarness h, Principal who, long expectedVersion, String commandId) {
        ObjectNode in = ApptFixture.JSON.createObjectNode().put("commandId", commandId).put("orderUuid", ORDER)
                .put("expectedVersion", expectedVersion);
        return h.service.noShow(who, h.run, in);
    }

    static AppointmentResult noShow(ApptHarness h) {
        return noShow(h, h.greg, h.read(h.greg).get("version").asLong(), "ns-" + System.nanoTime());
    }

    static long events(ApptHarness h) throws SQLException {
        return h.count("SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-no-show'");
    }

    @Test
    void aNoShowKeepsTheProviderReferenceAndRecordsTheExceptionInTheSameCommit() throws Exception {
        try (ApptHarness h = scheduledAtSlot()) {
            long version = h.read(h.greg).get("version").asLong();
            JsonNode done = ok(noShow(h, h.greg, version, "ns-1"));
            assertEquals("no-show", done.get("state").asText());
            assertEquals("employee", done.get("owner").asText());
            assertEquals("Your handover was missed. Choose a new slot to rebook.", done.get("nextStep").asText());
            assertEquals(1, done.get("attempt").asInt());
            assertTrue(done.get("previousAttempts").isEmpty());
            String ref = done.get("outcome").get("providerReference").asText();
            assertTrue(ref.matches("SYN-APT-[0-9A-F]{12}"), ref);
            assertEquals("no-show", done.get("outcome").get("state").asText());
            assertEquals(Iso.format(h.now), done.get("outcome").get("at").asText());
            assertEquals(List.of("requested", "scheduled", "no-show"), done.get("history").findValuesAsText("state"));
            assertEquals(ref, done.get("history").get(2).get("providerReference").asText());
            assertEquals(1, h.provider.count("no-show"));
            assertEquals("acknowledged", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals("lifecycle-appointment-no-show", h.fx.stringOf(
                    "SELECT operation_type FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals(0, AppointmentCompletionTest.completedOutbox(h));
            assertEquals(1, events(h));
            assertEquals(OP, h.fx.stringOf("SELECT event_id FROM outbox_events WHERE event_type = 'appointment-no-show'"));
            JsonNode event = ApptFixture.JSON.readTree(h.fx.stringOf(
                    "SELECT payload::text FROM outbox_events WHERE event_type = 'appointment-no-show'"));
            assertEquals(List.of("attempt", "employeeId", "entitlementSlotId", "exceptionType", "fictional", "occurredAt",
                    "orderUuid", "policyVersion", "providerReference", "renewalAuthority", "renewalId"),
                    AppointmentServiceTest.keys(event));
            assertEquals("appointment-no-show", event.get("exceptionType").asText());
            assertEquals("validated", event.get("renewalAuthority").asText());
            assertEquals("slot-paula", event.get("entitlementSlotId").asText());
            assertEquals("renewal:employee-paula", event.get("renewalId").asText());
            assertEquals(ref, event.get("providerReference").asText());
            assertEquals(1, event.get("attempt").asInt());
            assertTrue(event.get("fictional").asBoolean());

            assertEquals(done, ok(noShow(h, h.greg, 1, "ns-2")), "a repeat with a stale version is the stored outcome");
            assertEquals(done, ok(noShow(h, h.greg, version, "ns-1")), "the same command id replays");
            assertEquals(1, h.provider.count("no-show"));
            assertEquals(1, events(h));
            assertEquals(done, h.read(h.paula));
        }
    }

    @Test
    void anOrderWithoutAnOpenStageRecordsMissingRenewalAuthority() throws Exception {
        try (ApptHarness h = scheduledAtSlot()) {
            h.stages.order(ORDER, "employee-paula", 2);
            ok(noShow(h));
            JsonNode event = ApptFixture.JSON.readTree(h.fx.stringOf(
                    "SELECT payload::text FROM outbox_events WHERE event_type = 'appointment-no-show'"));
            assertEquals("missing", event.get("renewalAuthority").asText());
            assertTrue(event.get("renewalId").isNull());
            assertTrue(event.get("entitlementSlotId").isNull());
        }
    }

    @Test
    void onlyGregRecordsANoShow() throws Exception {
        try (ApptHarness h = scheduledAtSlot()) {
            long version = h.read(h.greg).get("version").asLong();
            for (Principal who : List.of(h.presenter, h.paula, h.alex)) {
                assertInstanceOf(AppointmentResult.Forbidden.class, noShow(h, who, version, "c-" + who.subject()));
            }
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals(0, events(h));
            assertEquals("no-show", ok(noShow(h, h.greg, version, "c-greg")).get("state").asText());
        }
    }

    @Test
    void itIsRefusedBeforeTheSlotStartsAndWhenNotScheduledOrPending() throws Exception {
        try (ApptHarness h = ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.outcomeTiming.v1")
                .put("noShowAfterSlotStartSeconds", 900))) {
            assertInstanceOf(AppointmentResult.NotFound.class, noShow(h, h.greg, 0, "n-0"));
            ok(h.request(h.paula, h.firstSlot(), 0));
            assertConflict("appointment-not-scheduled", noShow(h));
            h.advance(ApptHarness.DELAY);
            h.tick();
            JsonNode view = h.read(h.paula);
            Instant from = Instant.parse(view.get("slot").get("start").asText()).plusSeconds(900);
            AppointmentCompletionTest.clockAtSlot(h, view, 899);
            AppointmentResult.Conflict early = assertInstanceOf(AppointmentResult.Conflict.class, noShow(h));
            assertEquals("appointment-outcome-too-early", early.code());
            assertEquals(Iso.format(from), early.extra().get("availableFrom").asText());
            assertEquals("scheduled", early.extra().get("appointment").get("state").asText());
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
            h.fx.update("UPDATE appointments SET pending_step = 'accept', pending_operation_id = 'op-other', version = version + 1");
            assertConflict("appointment-update-pending", noShow(h));
            h.fx.update("UPDATE appointments SET pending_step = NULL, pending_operation_id = NULL, version = version + 1");
            AppointmentCompletionTest.clockAtSlot(h, view, 900);
            long version = h.read(h.greg).get("version").asLong();
            assertConflict("stale-version", noShow(h, h.greg, version + 4, "n-stale"));
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals("no-show", ok(noShow(h, h.greg, version, "n-ok")).get("state").asText());
        }
    }

    @Test
    void aRefusedNoShowIsBlockedNotRecordedAndNeverRetried() throws Exception {
        try (ApptHarness h = scheduledAtSlot()) {
            h.provider.fault.put("no-show", new ProviderAnswer.Unsupported("no-show-not-connected", "No-show is not connected."));
            AppointmentResult.Unsupported u = assertInstanceOf(AppointmentResult.Unsupported.class, noShow(h));
            assertEquals("no-show-not-connected", u.code());
            assertEquals("scheduled", u.appointment().get("state").asText());
            assertTrue(u.appointment().get("outcome").isNull());
            assertEquals("refused", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP));
            assertInstanceOf(AppointmentResult.Unsupported.class, noShow(h));
            h.advance(ApptHarness.DELAY);
            h.tick();
            assertEquals(1, h.provider.count("no-show"));
            assertEquals(0, events(h));
            assertEquals("scheduled", h.read(h.greg).get("state").asText());
        }
        try (ApptHarness h = ApptHarness.live()) {
            String slot = "{\"slotId\":\"slot-x\",\"start\":\"2026-11-05T08:00:00.000Z\",\"end\":\"2026-11-05T09:00:00.000Z\"}";
            h.fx.update("INSERT INTO appointments (environment_id, run_id, order_uuid, employee_id, state, policy_version, "
                    + "provider_mode, opening, confirmation, requested_slot, slot) VALUES (?, 'run-1', ?, 'employee-paula', "
                    + "'scheduled', 'gcsp-policy-v1', 'live', '{}'::jsonb, '{}'::jsonb, ?::jsonb, ?::jsonb)", ApptFixture.ENV, ORDER,
                    slot, slot);
            AppointmentResult.Unsupported u = assertInstanceOf(AppointmentResult.Unsupported.class, noShow(h, h.greg, 1, "n-live"));
            assertEquals("live-appointments-unsupported", u.code());
            assertTrue(u.appointment().get("outcome").isNull());
            assertEquals(0, events(h));
        }
    }

    /** Lost, thrown after the provider recorded it, or hung: each stays pending under one operation id. */
    @Test
    void anUncertainNoShowIsReconciledBeforeAnyRetryUnderTheSameOperationId() throws Exception {
        for (String fault : List.of("lost", "throw-after", "hang")) {
            for (boolean viaTick : List.of(false, true)) {
                String label = fault + (viaTick ? "/tick" : "/repeat");
                try (ApptHarness h = ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.confirmation.v1")
                        .put("providerTimeoutMs", 50))) {
                    AppointmentCompletionTest.clockAtSlot(h, AppointmentCompletionTest.scheduled(h), 0);
                    h.provider.fault.put("no-show", fault);
                    JsonNode pending = ok(noShow(h));
                    assertEquals("scheduled", pending.get("state").asText(), label);
                    assertEquals("no-show", pending.get("pending").get("step").asText(), label);
                    assertEquals("pending", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP), label);
                    assertEquals(0, events(h), label);
                    h.provider.calls.clear();
                    JsonNode done = viaTick ? tickThenRead(h) : ok(noShow(h));
                    assertEquals("no-show", done.get("state").asText(), label);
                    List<String> want = "throw-after".equals(fault) ? List.of("reconcile") : List.of("reconcile", "no-show");
                    assertEquals(want, h.provider.calls, label);
                    assertEquals(1, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP), label);
                    assertEquals(1, h.count("SELECT count(*) FROM synthetic_appointment_receipts WHERE operation_id = ?", OP), label);
                    assertEquals(1, events(h), label);
                }
            }
        }
    }

    private static JsonNode tickThenRead(ApptHarness h) {
        h.tick();
        return h.read(h.greg);
    }

    @Test
    void aRestartReconcilesAPendingNoShowWithoutWritingNewOperations() throws Exception {
        try (ApptHarness h = scheduledAtSlot()) {
            h.provider.fault.put("no-show", "throw-after");
            ok(noShow(h));
            assertEquals("scheduled", h.read(h.greg).get("state").asText());
            h.start();
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals(List.of("reconcile"), h.provider.calls);
            assertEquals("no-show", h.read(h.greg).get("state").asText());
            assertEquals(1, events(h));
        }
        try (ApptHarness h = scheduledAtSlot()) {
            h.provider.fault.put("no-show", "lost");
            ok(noShow(h));
            h.start();
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals(List.of("reconcile"), h.provider.calls, "a not-found answer is never written on startup");
            assertEquals("no-show", h.read(h.greg).get("pending").get("step").asText());
            assertEquals(0, events(h));
            h.tick();
            assertEquals("no-show", h.read(h.greg).get("state").asText());
            assertEquals(1, events(h));
        }
    }

    @Test
    void rebookingStartsASecondAttemptUnderItsOwnIdsAndNeverOffersAMissedSlot() throws Exception {
        try (ApptHarness h = sameDayOffers(2000)) {
            JsonNode before = h.read(h.paula);
            JsonNode missed = before.get("slot");
            JsonNode done = ok(noShow(h));
            assertEquals("no-show", done.get("state").asText());
            List<String> offered = done.get("offeredSlots").findValuesAsText("slotId");
            assertTrue(offered.size() > 0);
            assertTrue(!offered.contains(missed.get("slotId").asText()), "the missed slot is not offered again");

            long version = done.get("version").asLong();
            assertInstanceOf(AppointmentResult.Invalid.class, h.request(h.paula, ORDER, missed.get("slotId").asText(), version, "rb-missed"));
            assertConflict("stale-version", h.request(h.paula, ORDER, offered.get(0), version + 1, "rb-stale"));
            h.stages.order(ORDER, "employee-paula", 2);
            assertConflict("appointment-not-eligible", h.request(h.paula, ORDER, offered.get(0), version, "rb-closed"));
            h.stages.order(ORDER, "employee-paula", 4);
            assertInstanceOf(AppointmentResult.Forbidden.class, h.request(h.alex, ORDER, offered.get(0), version, "rb-alex"));
            assertEquals("no-show", h.read(h.paula).get("state").asText());

            JsonNode second = ok(h.request(h.paula, ORDER, offered.get(0), version, "rb-1"));
            assertEquals("requested", second.get("state").asText());
            assertEquals(2, second.get("attempt").asInt());
            assertEquals(offered.get(0), second.get("requestedSlot").get("slotId").asText());
            assertTrue(second.get("slot").isNull());
            assertTrue(second.get("outcome").isNull());
            assertEquals(1, second.get("previousAttempts").size());
            JsonNode prior = second.get("previousAttempts").get(0);
            assertEquals(1, prior.get("attempt").asInt());
            assertEquals("no-show", prior.get("state").asText());
            assertEquals(missed, prior.get("slot"));
            assertEquals(done.get("outcome"), prior.get("outcome"));
            assertEquals(List.of("requested", "scheduled", "no-show", "requested"), second.get("history").findValuesAsText("state"));
            String req2 = AppointmentIds.operationId("run-1", ORDER, "request", 2);
            assertTrue(req2.contains(":a2:request"), req2);
            assertEquals("acknowledged", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", req2));
            assertEquals(2, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'request'"));
            assertEquals(1, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'no-show' AND attempt = 1"));

            ok(h.request(h.paula, ORDER, offered.get(0), version, "rb-1"));
            assertEquals(2, h.provider.count("request"), "the same command id replays without a new write");
            assertConflict("appointment-already-requested", h.request(h.paula, ORDER, offered.get(1), second.get("version").asLong(), "rb-2"));

            h.advance(ApptHarness.DELAY);
            h.tick();
            JsonNode scheduled = h.read(h.paula);
            assertEquals("scheduled", scheduled.get("state").asText());
            assertEquals(2, scheduled.get("attempt").asInt());
            assertEquals(1, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?",
                    AppointmentIds.operationId("run-1", ORDER, "confirm", 2)));

            AppointmentCompletionTest.clockAtSlot(h, scheduled, 0);
            h.readiness.mode = StubReadiness.Mode.READY;
            JsonNode completed = ok(AppointmentCompletionTest.complete(h));
            assertEquals("completed", completed.get("state").asText());
            assertEquals(1, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?",
                    AppointmentIds.operationId("run-1", ORDER, "complete", 2)));
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?",
                    AppointmentIds.operationId("run-1", ORDER, "complete")));
            assertEquals(List.of("requested", "scheduled", "no-show", "requested", "scheduled", "completed"),
                    completed.get("history").findValuesAsText("state"));
            assertEquals(1, completed.get("previousAttempts").size());
            assertConflict("appointment-not-scheduled", noShow(h));
            assertThrows(SQLException.class, () -> h.fx.update("UPDATE appointments SET blocked = NULL, version = version + 1"));
            assertThrows(SQLException.class, () -> h.fx.update("UPDATE appointment_history SET provider_reference = 'x'"));
        }
    }
}
