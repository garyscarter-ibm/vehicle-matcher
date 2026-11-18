package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.returns.AppointmentSlot;
import gcsp.api.returns.HandoverReading;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The pure mapping of an appointment row to the returns handover reading. */
class ReturnsHandoverTest {

    static AppointmentStore.Row row(String state, Slot slot) {
        return new AppointmentStore.Row("order-1", "employee-paula", state, "v1", "synthetic", null, null, null, slot, null,
                null, null, null, null, null, null, 1, 0, null, List.of());
    }

    @Test
    void aScheduledAppointmentCarriesTheSlotAndTheLastHistoryReference() {
        Slot slot = new Slot("slot-20261106T0900Z", "2026-11-06T09:00:00.000Z", "2026-11-06T10:00:00.000Z");
        List<AppointmentStore.Hist> history = List.of(new AppointmentStore.Hist("requested", Instant.EPOCH, null),
                new AppointmentStore.Hist("scheduled", Instant.EPOCH, "prov-7"));
        HandoverReading.Found f = ReturnsHandover.found(row("scheduled", slot), history);
        assertEquals("scheduled", f.state());
        assertEquals(new AppointmentSlot("slot-20261106T0900Z", Instant.parse("2026-11-06T09:00:00Z"),
                Instant.parse("2026-11-06T10:00:00Z")), f.slot());
        assertEquals("prov-7", f.providerReference());
    }

    @Test
    void anUnbookedAppointmentHasNoSlotAndNoReference() {
        HandoverReading.Found f = ReturnsHandover.found(row("requested", null), List.of());
        assertEquals("requested", f.state());
        assertNull(f.slot());
        assertNull(f.providerReference());
    }

    @Test
    void anUnparsableSlotIsNull() {
        assertNull(ReturnsHandover.slot(new Slot("s", "not-a-time", "2026-11-06T10:00:00.000Z")));
        assertNull(ReturnsHandover.slot(null));
    }
}
