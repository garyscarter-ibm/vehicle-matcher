package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class AppointmentIdsTest {

    static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";

    @Test
    void operationIdsMatchNode() {
        String request = AppointmentIds.operationId("run-1", ORDER, "request");
        assertEquals("appointment:b98fd174551e4e7e08f722f6eff0aef9:request", request);
        assertEquals("appointment:b98fd174551e4e7e08f722f6eff0aef9:complete", AppointmentIds.operationId("run-1", ORDER, "complete"));
        assertEquals("SYN-APT-87324029E37A", SyntheticAppointments.reference(request));
    }

    @Test
    void typesAndSteps() {
        assertEquals("lifecycle-appointment-confirm", AppointmentIds.operationType("confirm"));
        assertEquals("lifecycle-appointment-accept", AppointmentIds.operationType("accept"));
        assertThrows(IllegalArgumentException.class, () -> AppointmentIds.operationId("run-1", ORDER, "noShow"));
        assertThrows(IllegalArgumentException.class, () -> AppointmentIds.operationType("nope"));
    }
}
