package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHarness.ORDER;
import static gcsp.api.appointments.ApptHarness.assertConflict;
import static gcsp.api.appointments.ApptHarness.ok;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class AppointmentCompletionTest {

    static final String OP = AppointmentIds.operationId("run-1", ORDER, "complete");

    /** A scheduled appointment, the clock still at the confirmation time. */
    static JsonNode scheduled(ApptHarness h) {
        ok(h.request(h.paula, h.firstSlot(), 0));
        h.advance(ApptHarness.DELAY);
        h.tick();
        JsonNode view = h.read(h.paula);
        assertEquals("scheduled", view.get("state").asText());
        return view;
    }

    /** Moves the presenter clock to the booked slot start plus the given seconds. */
    static void clockAtSlot(ApptHarness h, JsonNode view, long plusSeconds) {
        h.recordTick(Instant.parse(view.get("slot").get("start").asText()).plusSeconds(plusSeconds));
    }

    static ApptHarness scheduledAtSlot(StubReadiness.Mode mode) throws Exception {
        ApptHarness h = ApptHarness.create();
        clockAtSlot(h, scheduled(h), 0);
        h.readiness.mode = mode;
        return h;
    }

    static ApptHarness shortTimeout() throws Exception {
        ApptHarness h = ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.confirmation.v1")
                .put("providerTimeoutMs", 50));
        clockAtSlot(h, scheduled(h), 0);
        h.readiness.mode = StubReadiness.Mode.READY;
        return h;
    }

    static AppointmentResult complete(ApptHarness h, Principal who, long expectedVersion, String commandId) {
        ObjectNode in = ApptFixture.JSON.createObjectNode().put("commandId", commandId).put("orderUuid", ORDER)
                .put("expectedVersion", expectedVersion);
        return h.service.complete(who, h.run, in);
    }

    static AppointmentResult complete(ApptHarness h) {
        return complete(h, h.greg, h.read(h.greg).get("version").asLong(), "complete-" + System.nanoTime());
    }

    static long completedOutbox(ApptHarness h) throws SQLException {
        return h.count("SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-completed'");
    }

    static void assertNothingWritten(ApptHarness h) throws SQLException {
        assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
        assertEquals(0, h.count("SELECT count(*) FROM appointment_operation_inputs WHERE step = 'complete'"));
        assertEquals(2, h.count("SELECT count(*) FROM appointment_history"));
        assertEquals(0, completedOutbox(h));
        assertEquals(0, h.provider.count("complete"));
        assertEquals("scheduled", h.fx.stringOf("SELECT state FROM appointments"));
    }

    @Test
    void refusedUntilReadinessIsCompleteThenCompletedOnce() throws Exception {
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.NOT_READY)) {
            long version = h.read(h.greg).get("version").asLong();
            AppointmentResult.Conflict notReady = assertInstanceOf(AppointmentResult.Conflict.class,
                    complete(h, h.greg, version, "c-1"));
            assertEquals("handover-not-ready", notReady.code());
            JsonNode x = notReady.extra();
            assertEquals("The retailer finishes the documents and car preparation before the handover.", notReady.reason());
            assertEquals(notReady.reason(), x.get("nextStep").asText());
            assertEquals("retailer", x.get("owner").asText());
            assertEquals("documents-pending", x.get("readiness").get("state").asText());
            assertFalse(x.get("readiness").get("documentsComplete").asBoolean());
            assertTrue(x.get("readiness").get("vehicleReady").asBoolean());
            assertEquals("signed-order-form", x.get("readiness").get("blocking").get(0).asText());
            assertEquals("scheduled", x.get("appointment").get("state").asText());
            assertNothingWritten(h);

            h.readiness.mode = StubReadiness.Mode.READY;
            JsonNode done = ok(complete(h, h.greg, version, "c-2"));
            assertEquals("completed", done.get("state").asText());
            assertFalse(done.get("booked").asBoolean());
            assertTrue(done.get("pending").isNull());
            assertTrue(done.get("blocked").isNull());
            String ref = done.get("outcome").get("providerReference").asText();
            assertTrue(ref.matches("SYN-APT-[0-9A-F]{12}"), ref);
            assertEquals(List.of("requested", "scheduled", "completed"), done.get("history").findValuesAsText("state"));
            assertEquals(ref, done.get("history").get(2).get("providerReference").asText());
            assertEquals(Iso.format(h.now), done.get("outcome").get("at").asText());
            assertEquals(Iso.format(h.now), done.get("history").get(2).get("at").asText());
            assertEquals(1, h.provider.count("complete"));
            assertEquals("acknowledged", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals(1, completedOutbox(h));
            JsonNode event = ApptFixture.JSON.readTree(h.fx.stringOf(
                    "SELECT payload::text FROM outbox_events WHERE event_type = 'appointment-completed'"));
            assertEquals(OP, h.fx.stringOf("SELECT event_id FROM outbox_events WHERE event_type = 'appointment-completed'"));
            assertEquals(List.of("employeeId", "occurredAt", "orderUuid", "policyVersion", "providerReference", "slotId"),
                    AppointmentServiceTest.keys(event));
            assertEquals(ORDER, event.get("orderUuid").asText());
            assertEquals("employee-paula", event.get("employeeId").asText());
            assertEquals(Iso.format(h.now), event.get("occurredAt").asText());
            assertEquals(ref, event.get("providerReference").asText());
            assertEquals(done.get("slot").get("slotId").asText(), event.get("slotId").asText());
            assertEquals("gcsp-policy-v1", event.get("policyVersion").asText());
            JsonNode input = ApptFixture.JSON.readTree(h.fx.stringOf(
                    "SELECT payload::text FROM appointment_operation_inputs WHERE step = 'complete'"));
            assertEquals("docs-rev-7", input.get("readiness").get("documentsRevision").asText());
            assertEquals(Iso.format(h.now), input.get("completedAt").asText());
            assertEquals(1, h.count("SELECT count(*) FROM synthetic_appointment_receipts WHERE operation_id = ?", OP));

            int reads = h.readiness.reads.get();
            assertEquals(done, ok(complete(h, h.greg, 1, "c-3")), "a repeat with a stale version is still the current model");
            assertEquals(done, ok(complete(h, h.greg, version, "c-2")), "the same command id replays");
            assertEquals(reads, h.readiness.reads.get());
            assertEquals(1, h.provider.count("complete"));
            assertEquals(1, completedOutbox(h));
        }
    }

    @Test
    void anUnavailableReadinessPortWritesNothing() throws Exception {
        for (StubReadiness.Mode mode : List.of(StubReadiness.Mode.UNAVAILABLE, StubReadiness.Mode.THROWS)) {
            try (ApptHarness h = scheduledAtSlot(mode)) {
                AppointmentResult.Unavailable u = assertInstanceOf(AppointmentResult.Unavailable.class, complete(h));
                assertEquals("handover-readiness-unavailable", u.code());
                assertTrue(u.retryable());
                assertEquals("Documents and car preparation cannot be checked right now. Try again shortly.", u.reason());
                assertNothingWritten(h);
            }
        }
        try (ApptHarness h = ApptHarness.create()) {
            clockAtSlot(h, scheduled(h), 0);
            h.readiness.mode = StubReadiness.Mode.UNAVAILABLE;
            AppointmentResult.Unavailable u = assertInstanceOf(AppointmentResult.Unavailable.class, complete(h));
            assertEquals("handover-readiness-unavailable", u.code());
            assertEquals(1, h.readiness.reads.get());
            h.readiness.mode = StubReadiness.Mode.READY;
            assertEquals("completed", ok(complete(h)).get("state").asText());
        }
    }

    @Test
    void onlyAScheduledAppointmentCanBeCompletedAndNeverConsultsReadiness() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            assertInstanceOf(AppointmentResult.NotFound.class, complete(h, h.greg, 0, "c-0"));
            ok(h.request(h.paula, h.firstSlot(), 0));
            AppointmentResult.Conflict c = assertInstanceOf(AppointmentResult.Conflict.class,
                    complete(h, h.greg, h.read(h.greg).get("version").asLong(), "c-1"));
            assertEquals("appointment-not-scheduled", c.code());
            assertEquals("Only a scheduled handover can be completed.", c.reason());
            assertEquals(0, h.readiness.reads.get());
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
        }
        try (ApptHarness h = AppointmentServiceTest.proposing()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(ApptHarness.DELAY);
            h.tick();
            assertEquals("change-proposed", h.read(h.greg).get("state").asText());
            assertConflict("appointment-not-scheduled", complete(h));
            assertEquals(0, h.readiness.reads.get());
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
        }
        try (ApptHarness h = ApptHarness.create()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            clockAtSlot(h, scheduled(h), 0);
            h.provider.fault.put("accept", "lost");
            ObjectNode in = ApptFixture.JSON.createObjectNode().put("commandId", "m").put("orderUuid", ORDER);
            for (ObjectNode bad : List.of(in.deepCopy().put("expectedVersion", 1).put("runId", "r"),
                    in.deepCopy(), in.deepCopy().put("expectedVersion", -1), in.deepCopy().put("expectedVersion", "1"),
                    in.deepCopy().put("expectedVersion", 1).put("orderUuid", ""),
                    ApptFixture.JSON.createObjectNode().put("orderUuid", ORDER).put("expectedVersion", 1))) {
                assertInstanceOf(AppointmentResult.Invalid.class, h.service.complete(h.greg, h.run, bad), bad.toString());
            }
            assertInstanceOf(AppointmentResult.Invalid.class, h.service.complete(h.greg, h.run, null));
            assertEquals(0, h.readiness.reads.get());
            assertEquals(0, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP));
        }
    }

    @Test
    void anotherPendingStepBlocksCompletion() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            clockAtSlot(h, scheduled(h), 0);
            h.fx.update("UPDATE appointments SET pending_step = 'accept', pending_operation_id = 'op-other', "
                    + "version = version + 1");
            assertConflict("appointment-update-pending", complete(h));
            assertEquals(0, h.readiness.reads.get());
        }
    }

    @Test
    void onlyGregCompletes() throws Exception {
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            long version = h.read(h.greg).get("version").asLong();
            for (Principal who : List.of(h.presenter, h.paula, h.alex)) {
                assertInstanceOf(AppointmentResult.Forbidden.class, complete(h, who, version, "c-" + who.subject()));
            }
            assertEquals(0, h.readiness.reads.get());
            assertNothingWritten(h);
            assertEquals("completed", ok(complete(h, h.greg, version, "c-greg")).get("state").asText());
        }
    }

    @Test
    void theOutcomeIsRefusedBeforeTheSlotStartsAndTheBoundaryFollowsPolicy() throws Exception {
        try (ApptHarness h = ApptHarness.create()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            JsonNode view = scheduled(h);
            String start = view.get("slot").get("start").asText();
            clockAtSlot(h, view, -1);
            AppointmentResult.Conflict early = assertInstanceOf(AppointmentResult.Conflict.class, complete(h));
            assertEquals("appointment-outcome-too-early", early.code());
            assertEquals(start, early.extra().get("availableFrom").asText());
            assertEquals("retailer", early.extra().get("owner").asText());
            assertEquals("The handover outcome can be recorded once the booked slot starts.", early.extra().get("nextStep").asText());
            assertEquals(early.extra().get("nextStep").asText(), early.reason());
            assertEquals("scheduled", early.extra().get("appointment").get("state").asText());
            assertNothingWritten(h);
            clockAtSlot(h, view, 0);
            assertEquals("completed", ok(complete(h)).get("state").asText());
        }
        try (ApptHarness h = ApptHarness.create(false, d -> ApptHarness.value(d, "lifecycle.appointments.outcomeTiming.v1")
                .put("completeAfterSlotStartSeconds", 1800))) {
            h.readiness.mode = StubReadiness.Mode.READY;
            JsonNode view = scheduled(h);
            Instant from = Instant.parse(view.get("slot").get("start").asText()).plusSeconds(1800);
            clockAtSlot(h, view, 1799);
            AppointmentResult.Conflict early = assertInstanceOf(AppointmentResult.Conflict.class, complete(h));
            assertEquals(Iso.format(from), early.extra().get("availableFrom").asText());
            assertNothingWritten(h);
            clockAtSlot(h, view, 1800);
            assertEquals("completed", ok(complete(h)).get("state").asText());
        }
        try (ApptHarness h = ApptHarness.create(false, d -> {
            ArrayNode rows = (ArrayNode) d.get("assumptions");
            for (int i = rows.size() - 1; i >= 0; i--) {
                if ("lifecycle.appointments.outcomeTiming.v1".equals(rows.get(i).get("key").asText())) rows.remove(i);
            }
        })) {
            h.readiness.mode = StubReadiness.Mode.READY;
            clockAtSlot(h, scheduled(h), 0);
            AppointmentResult.Unavailable u = assertInstanceOf(AppointmentResult.Unavailable.class, complete(h));
            assertEquals("appointment-policy-unavailable", u.code());
            assertNothingWritten(h);
        }
    }

    @Test
    void aStaleVersionIsRefusedAndTheCurrentOneIsReported() throws Exception {
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            long version = h.read(h.greg).get("version").asLong();
            AppointmentResult.Conflict stale = assertInstanceOf(AppointmentResult.Conflict.class,
                    complete(h, h.greg, version + 3, "c-stale"));
            assertEquals("stale-version", stale.code());
            assertEquals(version, stale.extra().get("currentVersion").asLong());
            assertNothingWritten(h);
        }
    }

    @Test
    void aRefusedCompletionIsBlockedNotCompletedAndNeverRetried() throws Exception {
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            h.provider.fault.put("complete", new ProviderAnswer.Unsupported("completion-not-connected", "Completion is not connected."));
            AppointmentResult.Unsupported u = assertInstanceOf(AppointmentResult.Unsupported.class, complete(h));
            assertEquals("completion-not-connected", u.code());
            assertEquals("Completion is not connected.", u.reason());
            JsonNode a = u.appointment();
            assertEquals("scheduled", a.get("state").asText());
            assertTrue(a.get("outcome").isNull());
            assertEquals("Completion is not connected.", a.get("blocked").get("reason").asText());
            assertTrue(a.get("pending").isNull());
            assertEquals("refused", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP));
            assertEquals(2, h.count("SELECT count(*) FROM appointment_history"));
            assertEquals(0, completedOutbox(h));
            int reads = h.readiness.reads.get();
            AppointmentResult.Unsupported again = assertInstanceOf(AppointmentResult.Unsupported.class, complete(h));
            assertEquals("Completion is not connected.", again.reason());
            h.advance(ApptHarness.DELAY);
            h.tick();
            assertEquals(1, h.provider.count("complete"));
            assertEquals(reads, h.readiness.reads.get());
            assertEquals("scheduled", h.read(h.greg).get("state").asText());
            assertEquals(0, completedOutbox(h));
        }
        try (ApptHarness h = ApptHarness.live()) {
            h.fx.update("INSERT INTO appointments (environment_id, run_id, order_uuid, employee_id, state, policy_version, "
                    + "provider_mode, opening, confirmation, requested_slot, slot) VALUES (?, 'run-1', ?, 'employee-paula', "
                    + "'scheduled', 'gcsp-policy-v1', 'live', '{}'::jsonb, '{}'::jsonb, ?::jsonb, ?::jsonb)", ApptFixture.ENV, ORDER,
                    "{\"slotId\":\"slot-x\",\"start\":\"2026-11-05T08:00:00.000Z\",\"end\":\"2026-11-05T09:00:00.000Z\"}",
                    "{\"slotId\":\"slot-x\",\"start\":\"2026-11-05T08:00:00.000Z\",\"end\":\"2026-11-05T09:00:00.000Z\"}");
            h.readiness.mode = StubReadiness.Mode.READY;
            AppointmentResult.Unsupported u = assertInstanceOf(AppointmentResult.Unsupported.class,
                    complete(h, h.greg, 1, "c-live"));
            assertEquals("live-appointments-unsupported", u.code());
            assertEquals("scheduled", u.appointment().get("state").asText());
            assertTrue(u.appointment().get("outcome").isNull());
            assertEquals(0, completedOutbox(h));
        }
    }

    /** Lost, thrown after the provider recorded it, or hung: each stays pending under one operation id. */
    @Test
    void anUncertainCompletionIsRecoveredByARepeatAndByATick() throws Exception {
        for (String fault : List.of("lost", "throw-after", "hang")) {
            for (boolean viaTick : List.of(false, true)) {
                String label = fault + (viaTick ? "/tick" : "/repeat");
                try (ApptHarness h = shortTimeout()) {
                    h.provider.fault.put("complete", fault);
                    JsonNode pending = ok(complete(h));
                    assertEquals("scheduled", pending.get("state").asText(), label);
                    assertEquals("complete", pending.get("pending").get("step").asText(), label);
                    assertTrue(pending.get("outcome").isNull(), label);
                    assertEquals("pending", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP), label);
                    assertEquals(0, completedOutbox(h), label);
                    int reads = h.readiness.reads.get();
                    h.provider.calls.clear();
                    JsonNode done = viaTick ? tickThenRead(h) : ok(complete(h));
                    assertEquals("completed", done.get("state").asText(), label);
                    List<String> want = "throw-after".equals(fault) ? List.of("reconcile") : List.of("reconcile", "complete");
                    assertEquals(want, h.provider.calls, label);
                    assertEquals(reads, h.readiness.reads.get(), label);
                    assertEquals(1, h.count("SELECT count(*) FROM pending_operations WHERE operation_id = ?", OP), label);
                    assertEquals(1, h.count("SELECT count(*) FROM synthetic_appointment_receipts WHERE operation_id = ?", OP), label);
                    assertEquals(1, completedOutbox(h), label);
                    assertEquals("acknowledged", h.fx.stringOf("SELECT state FROM pending_operations WHERE operation_id = ?", OP), label);
                    assertEquals(3, done.get("history").size(), label);
                }
            }
        }
    }

    private static JsonNode tickThenRead(ApptHarness h) {
        h.tick();
        return h.read(h.greg);
    }

    @Test
    void startupOnlyReconcilesACompletionAndTheNextTickFinishesIt() throws Exception {
        try (ApptHarness h = shortTimeout()) {
            h.provider.fault.put("complete", "lost");
            ok(complete(h));
            h.provider.calls.clear();
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals(List.of("reconcile"), h.provider.calls);
            JsonNode view = h.read(h.greg);
            assertEquals("scheduled", view.get("state").asText());
            assertEquals("complete", view.get("pending").get("step").asText());
            assertEquals(0, completedOutbox(h));
            h.tick();
            assertEquals(List.of("reconcile", "reconcile", "complete"), h.provider.calls);
            assertEquals("completed", h.read(h.greg).get("state").asText());
            assertEquals(1, completedOutbox(h));
        }
        try (ApptHarness h = shortTimeout()) {
            h.provider.fault.put("complete", "throw-after");
            ok(complete(h));
            h.provider.calls.clear();
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals(List.of("reconcile"), h.provider.calls);
            assertEquals("completed", h.read(h.greg).get("state").asText());
            assertEquals(1, completedOutbox(h));
        }
    }

    @Test
    void aCompletedAppointmentIsFinalAndShowsTheOutcomeShape() throws Exception {
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            JsonNode done = ok(complete(h));
            assertEquals(AppointmentServiceTest.sorted(AppointmentServiceTest.KEYS), AppointmentServiceTest.keys(done));
            assertEquals("retailer", done.get("owner").asText());
            assertEquals("Your handover is complete.", done.get("nextStep").asText());
            assertFalse(done.get("nextStep").asText().contains("—"));
            assertEquals(AppointmentServiceTest.sorted(List.of("state", "at", "providerReference")), AppointmentServiceTest.keys(done.get("outcome")));
            assertEquals("completed", done.get("outcome").get("state").asText());
            assertFalse(done.get("booked").asBoolean());
            assertFalse(done.get("slot").isNull());

            assertEquals(done, h.read(h.paula), "the owning employee reads their completed appointment");
            assertEquals(done, h.read(h.presenter));
            assertInstanceOf(AppointmentResult.Forbidden.class, h.readResult(h.alex, ORDER));

            assertThrows(SQLException.class, () -> h.fx.update("UPDATE appointments SET blocked = NULL, version = version + 1"));
            assertThrows(SQLException.class, () -> h.fx.update("DELETE FROM appointments"));
            h.provider.calls.clear();
            h.advance(ApptHarness.DELAY);
            JsonNode summary = h.tick();
            assertEquals(0, summary.get("orders").asInt());
            ok(h.service.reconcileOnStartup(h.run));
            assertEquals(List.of(), h.provider.calls);
            assertEquals(done, h.read(h.greg));
            assertConflict("appointment-already-requested", h.request(h.paula, "slot-other", done.get("version").asLong()));
            assertEquals(1, completedOutbox(h));
        }
    }

    @Test
    void planningNeverCompletes() throws Exception {
        try (ApptHarness h = AppointmentServiceTest.proposing()) {
            h.readiness.mode = StubReadiness.Mode.READY;
            ok(h.request(h.paula, h.firstSlot(), 0));
            h.advance(ApptHarness.DELAY);
            h.tick();
            JsonNode view = h.read(h.paula);
            ok(h.accept(h.paula, view.get("proposalId").asText(), view.get("version").asLong()));
            clockAtSlot(h, h.read(h.paula), 3600);
            for (int i = 0; i < 3; i++) h.tick();
            ok(h.service.reconcileOnStartup(h.run));
            assertConflict("appointment-already-requested", h.request(h.paula, "slot-other", h.read(h.paula).get("version").asLong()));
            assertEquals("scheduled", ok(h.accept(h.paula, view.get("proposalId").asText(), 0)).get("state").asText());
            assertEquals("scheduled", h.read(h.greg).get("state").asText());
            assertEquals(0, h.count("SELECT count(*) FROM appointments WHERE state = 'completed'"));
            assertEquals(0, h.provider.count("complete"));
            assertEquals(0, h.readiness.reads.get());
            assertEquals(0, completedOutbox(h));
        }
    }

    @Test
    void aCompletionIssuesAFixedNumberOfStatementsWhateverElseExists() throws Exception {
        int baseline;
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            baseline = statementsForComplete(h);
        }
        try (ApptHarness h = scheduledAtSlot(StubReadiness.Mode.READY)) {
            for (int i = 0; i < 50; i++) {
                h.fx.update("INSERT INTO appointments (environment_id, run_id, order_uuid, employee_id, state, policy_version, "
                        + "provider_mode, opening, confirmation, requested_slot, slot) VALUES (?, 'run-1', ?, 'employee-x', "
                        + "'scheduled', 'gcsp-policy-v1', 'synthetic', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)",
                        ApptFixture.ENV, "other-" + i);
            }
            assertEquals(baseline, statementsForComplete(h));
        }
    }

    private static int statementsForComplete(ApptHarness h) {
        long version = h.read(h.greg).get("version").asLong();
        h.statements.set(0);
        ok(complete(h, h.greg, version, "count-1"));
        return h.statements.get();
    }
}
