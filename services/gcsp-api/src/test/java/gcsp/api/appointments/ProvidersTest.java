package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class ProvidersTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";
    static final Instant NOW = Instant.parse("2026-11-05T10:30:00.000Z");
    static final SlotPolicy POLICY = SlotsTest.SEED;
    static final Slot SLOT = new Slot("slot-20261107T0900Z", "2026-11-07T09:00:00.000Z", "2026-11-07T10:00:00.000Z");

    ProviderOperation op(ApptFixture f, String step, ObjectNode payload) {
        String id = AppointmentIds.operationId("run-1", ORDER, step);
        return new ProviderOperation(f.ctx(), id, AppointmentIds.operationType(step), ORDER, step, SLOT, payload,
                Canonical.digest(payload.deepCopy().put("step", step)));
    }

    ObjectNode request() {
        return JSON.createObjectNode().put("requestedAt", "2026-11-05T10:30:00.000Z");
    }

    ObjectNode confirm(boolean propose) {
        ObjectNode p = JSON.createObjectNode().put("confirmAfter", "2026-11-05T11:00:00.000Z");
        p.putObject("scenario").put("proposeChange", propose).put("proposedSlot", "next-offered")
                .put("proposalReason", "The retailer proposed a different time.");
        p.set("slotPolicy", POLICY.toJson());
        return p;
    }

    @Test
    void requestIsRecordedOnceAndReplaysTheSameAnswer() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "request", request());
            ProviderAnswer.Accepted first = assertInstanceOf(ProviderAnswer.Accepted.class, p.write(op, NOW));
            assertEquals("SYN-APT-87324029E37A", first.providerReference());
            assertEquals(op.operationId(), first.operationId());
            assertEquals("request", first.step());
            assertEquals(SLOT, first.slot());
            assertEquals(Instant.parse("2026-11-05T10:30:00Z"), first.at());
            assertEquals(1, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertEquals(first, p.write(op, NOW.plusSeconds(3600)));
            assertEquals(1, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void changedInputUnderTheSameOperationIsAConflict() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "request", request());
            p.write(op, NOW);
            ProviderOperation changed = new ProviderOperation(op.context(), op.operationId(), op.operationType(), ORDER,
                    "request", SLOT, request(), Canonical.digest(JSON.createArrayNode().add("other")));
            assertInstanceOf(ProviderAnswer.Conflict.class, p.write(changed, NOW));
            assertInstanceOf(ProviderAnswer.Conflict.class, p.reconcile(changed));
            assertEquals(1, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void reconcileFindsTheStoredOutcomeOrNotFound() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "request", request());
            ProviderAnswer.NotFound nf = assertInstanceOf(ProviderAnswer.NotFound.class, p.reconcile(op));
            assertEquals(op.operationId(), nf.operationId());
            assertEquals(ORDER, nf.orderUuid());
            assertEquals("request", nf.step());
            ProviderAnswer written = p.write(op, NOW);
            assertEquals(written, p.reconcile(op));
            assertEquals(1, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void confirmIsInProgressBeforeConfirmAfterAndRecordsNothing() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "confirm", confirm(false));
            ProviderAnswer.InProgress w = assertInstanceOf(ProviderAnswer.InProgress.class,
                    p.write(op, Instant.parse("2026-11-05T10:59:59.999Z")));
            assertEquals(op.operationId(), w.operationId());
            assertEquals("confirm", w.step());
            assertEquals(0, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
            assertInstanceOf(ProviderAnswer.NotFound.class, p.reconcile(op));
        }
    }

    @Test
    void confirmSchedulesAfterTheDelayAndReplaysItsFirstAnswer() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "confirm", confirm(false));
            Instant due = Instant.parse("2026-11-05T11:00:00.000Z");
            ProviderAnswer.Scheduled s = assertInstanceOf(ProviderAnswer.Scheduled.class, p.write(op, due));
            assertEquals(SLOT, s.slot());
            assertEquals(due, s.at());
            assertTrue(s.providerReference().startsWith("SYN-APT-"));
            assertEquals(s, p.write(op, due.plusSeconds(600)));
            assertEquals(s, p.reconcile(op));
        }
    }

    @Test
    void confirmProposesTheNextSlotWhenTheScenarioSaysSo() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            ProviderOperation op = op(f, "confirm", confirm(true));
            ProviderAnswer.Proposed pr = assertInstanceOf(ProviderAnswer.Proposed.class,
                    p.write(op, Instant.parse("2026-11-05T11:00:00.000Z")));
            assertEquals("slot-20261107T1300Z", pr.proposedSlot().slotId());
            assertEquals(SLOT, pr.slot());
            assertEquals(pr.providerReference(), pr.proposalId());
            assertEquals("The retailer proposed a different time.", pr.reason());
            assertEquals(pr, p.reconcile(op));
        }
    }

    @Test
    void acceptAndCompleteAreRecorded() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            Slot proposed = new Slot("slot-20261107T1300Z", "2026-11-07T13:00:00.000Z", "2026-11-07T14:00:00.000Z");
            ObjectNode accept = JSON.createObjectNode().put("acceptedAt", "2026-11-05T12:00:00.000Z");
            accept.set("proposedSlot", proposed.toJson());
            ProviderAnswer.Scheduled s = assertInstanceOf(ProviderAnswer.Scheduled.class, p.write(op(f, "accept", accept), NOW));
            assertEquals(proposed, s.slot());
            assertEquals("accept", s.step());
            ProviderAnswer.Completed c = assertInstanceOf(ProviderAnswer.Completed.class, p.write(op(f, "complete",
                    JSON.createObjectNode().put("completedAt", "2026-11-07T09:30:00.000Z")), NOW));
            assertEquals(Instant.parse("2026-11-07T09:30:00Z"), c.at());
            assertEquals(2, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void invalidOperationsAreRefusedWithoutWriting() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(op(f, "request", JSON.createObjectNode()), NOW));
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(op(f, "confirm", JSON.createObjectNode()), NOW));
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(op(f, "accept", JSON.createObjectNode()), NOW));
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(op(f, "complete", JSON.createObjectNode()), NOW));
            ObjectNode noPolicy = confirm(true);
            noPolicy.remove("slotPolicy");
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(op(f, "confirm", noPolicy), Instant.parse("2026-11-06T00:00:00Z")));
            ProviderOperation bad = new ProviderOperation(f.ctx(), "x", "lifecycle-appointment-request", ORDER, "request",
                    SLOT, request(), "not-a-digest");
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.write(bad, NOW));
            assertInstanceOf(ProviderAnswer.Unsupported.class, p.reconcile(bad));
            assertEquals(0, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void syntheticOffersTheBuiltSlots() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            SyntheticAppointments p = new SyntheticAppointments(f.pool());
            assertEquals("synthetic", p.mode());
            SlotOffer.Offered o = assertInstanceOf(SlotOffer.Offered.class, p.offerSlots(NOW, POLICY));
            assertEquals(6, o.slots().size());
            assertEquals("slot-20261107T0900Z", o.slots().get(0).slotId());
            assertInstanceOf(SlotOffer.Unsupported.class, p.offerSlots(NOW, new SlotPolicy(0, 0, 60, List.of("09:00"))));
        }
    }

    @Test
    void liveStubRefusesEveryCallAndWritesNothing() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            LiveAppointmentsStub live = new LiveAppointmentsStub();
            assertEquals("live", live.mode());
            SlotOffer.Unsupported o = assertInstanceOf(SlotOffer.Unsupported.class, live.offerSlots(NOW, POLICY));
            assertEquals("live-appointments-unsupported", o.code());
            assertEquals("Live appointment booking is not connected yet. The appointment stays as it is.", o.reason());
            for (String step : AppointmentIds.STEPS) {
                ProviderOperation op = op(f, step, request());
                ProviderAnswer.Unsupported w = assertInstanceOf(ProviderAnswer.Unsupported.class, live.write(op, NOW));
                assertEquals("live-appointments-unsupported", w.code());
                assertEquals(o.reason(), w.reason());
                assertEquals("live-appointments-unsupported",
                        assertInstanceOf(ProviderAnswer.Unsupported.class, live.reconcile(op)).code());
            }
            assertEquals(0, f.count("SELECT count(*) FROM synthetic_appointment_receipts"));
        }
    }

    @Test
    void unconfiguredPortsAreUnavailable() {
        UnconfiguredAppointments none = new UnconfiguredAppointments();
        assertEquals("none", none.mode());
        assertInstanceOf(SlotOffer.Unavailable.class, none.offerSlots(NOW, POLICY));
        assertInstanceOf(ProviderAnswer.Unknown.class, none.write(null, NOW));
        assertInstanceOf(ProviderAnswer.Unknown.class, none.reconcile(null));
        assertInstanceOf(StageRead.Unavailable.class, new UnconfiguredOrderStage().read(null, ORDER));
        assertInstanceOf(HandoverReadiness.Unavailable.class, new UnconfiguredHandoverReadiness().read(null, ORDER));
        assertEquals(Optional.empty(), new UnconfiguredAppointmentClock().now(null));
    }

    @Test
    void tickClockReadsTheLatestTickNow() throws Exception {
        try (ApptFixture f = ApptFixture.create()) {
            TickClock clock = new TickClock(f.pool());
            assertEquals(Optional.empty(), clock.now(f.ctx()));
            String digest = "a".repeat(64);
            f.update("INSERT INTO appointment_ticks (environment_id, run_id, tick_id, tick_now, input_digest) "
                    + "VALUES (?, 'run-1', 't1', ?::timestamptz, ?)", ApptFixture.ENV, "2026-11-05T09:00:00Z", digest);
            f.update("INSERT INTO appointment_ticks (environment_id, run_id, tick_id, tick_now, input_digest) "
                    + "VALUES (?, 'run-1', 't2', ?::timestamptz, ?)", ApptFixture.ENV, "2026-11-05T10:15:30.250Z", digest);
            assertEquals(Optional.of(Instant.parse("2026-11-05T10:15:30.250Z")), clock.now(f.ctx()));
        }
    }
}
