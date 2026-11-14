package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TickReturnClockTest {

    static final String DIGEST = "a".repeat(64);

    @Test
    void readsTheLatestDeliveredTickOfTheRunAndIsEmptyWithoutOne() throws Exception {
        try (ReturnsFixture f = ReturnsFixture.create()) {
            TickReturnClock clock = new TickReturnClock(f.pool());
            assertTrue(clock.now(f.ctx()).isEmpty());
            f.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'run-2', 'retired', now())", ReturnsFixture.ENV);
            tick(f, "run-1", "t1", "2026-11-05T09:00:00Z", 1);
            tick(f, "run-1", "t2", "2026-11-05T10:00:00Z", 2);
            tick(f, "run-1", "t2b", "2026-11-05T09:30:00Z", 2);
            tick(f, "run-2", "t9", "2027-01-01T00:00:00Z", 9);
            assertEquals(Optional.of(Instant.parse("2026-11-05T09:30:00Z")), clock.now(f.ctx()));
            assertTrue(clock.now(new gcsp.api.persistence.RunContext(ReturnsFixture.ENV, "run-3", "x")).isEmpty());
        }
    }

    private static void tick(ReturnsFixture f, String run, String id, String now, long version) throws Exception {
        f.update("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, input_digest, state) "
                + "VALUES (?, ?, ?, ?::timestamptz, ?, ?, 'pending')", ReturnsFixture.ENV, run, id, now, version, DIGEST);
    }
}
