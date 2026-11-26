package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TickReturnClockTest {

    @Test
    void mapsTheActiveRunClockAndPreservesEmptyAndUnreadableStates() {
        Instant now = Instant.parse("2026-11-05T09:00:00Z");
        RunContext context = new RunContext("test-env", "run-1", "caller");
        TickReturnClock clock = new TickReturnClock((environmentId, runId) -> {
            assertEquals("test-env", environmentId);
            assertEquals("run-1", runId);
            return Optional.of(new ClockReading(now, 2));
        });

        assertEquals(Optional.of(now), clock.now(context));
        assertTrue(new TickReturnClock((environmentId, runId) -> Optional.empty()).now(context).isEmpty());

        ClockUnavailableException unavailable = new ClockUnavailableException("unreadable", new java.sql.SQLException());
        IllegalStateException translated = assertThrows(IllegalStateException.class,
                () -> new TickReturnClock((environmentId, runId) -> { throw unavailable; }).now(context));
        assertEquals(unavailable, translated.getCause());
    }
}
