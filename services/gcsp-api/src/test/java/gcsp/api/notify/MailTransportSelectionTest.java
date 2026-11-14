package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class MailTransportSelectionTest {

    @Test
    void unsetOrBlankKeepsMailCaptured() {
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.empty()));
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.of("")));
        assertInstanceOf(CapturedTransport.class, MailTransportSelection.select(Optional.of("   ")));
        assertEquals("captured", MailTransportSelection.select(Optional.empty()).name());
    }

    @Test
    void anUnknownTransportStopsStartup() {
        IllegalStateException refused = assertThrows(IllegalStateException.class,
                () -> MailTransportSelection.select(Optional.of("nonsense")));
        assertTrue(refused.getMessage().startsWith("Unknown mail transport"));
    }
}
