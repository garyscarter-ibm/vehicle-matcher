package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The startup provider rule, with no container: three names are accepted, anything else stops startup. */
class AppointmentsWiringTest {

    @Test
    void theThreeNamesSelectTheirProviders() {
        assertInstanceOf(UnconfiguredAppointments.class, AppointmentsWiring.select("none", () -> {
            throw new AssertionError("none must not open the datasource");
        }));
        assertInstanceOf(LiveAppointmentsStub.class, AppointmentsWiring.select("live", () -> {
            throw new AssertionError("live must not open the datasource");
        }));
        assertInstanceOf(SyntheticAppointments.class, AppointmentsWiring.select("synthetic", () -> null));
        assertEquals("synthetic", new SyntheticAppointments(null).mode());
    }

    @Test
    void blankAndUnsetMeanNoneAndNamesAreTrimmed() {
        assertEquals("none", AppointmentsWiring.normalise(null));
        assertEquals("none", AppointmentsWiring.normalise("  "));
        assertEquals("live", AppointmentsWiring.normalise(" live "));
    }

    @Test
    void anUnknownProviderStopsStartupWithAClearMessage() {
        for (String bad : new String[] {"Synthetic", "real", "tranche-plan", "none,live", "0"}) {
            IllegalStateException e = assertThrows(IllegalStateException.class, () -> AppointmentsWiring.normalise(bad), bad);
            assertTrue(e.getMessage().contains("gcsp.appointments.provider") && e.getMessage().contains(bad), e.getMessage());
            assertThrows(IllegalStateException.class, () -> AppointmentsWiring.select(bad, () -> null), bad);
        }
    }
}
