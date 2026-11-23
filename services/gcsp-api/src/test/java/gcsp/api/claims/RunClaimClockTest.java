package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.*;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** The scoped time authority, including its persistence-off compatibility boundary. */
class RunClaimClockTest {
    private static final RunContext CONTEXT = new RunContext("env-1", "run-1", "employee-paula");
    private static final Instant WALL = Instant.parse("2026-11-23T21:00:00Z");
    private static final Instant EARLIER = Instant.parse("2026-11-23T09:00:00Z");
    private static final ClaimClock NO_FALLBACK = context -> { throw new AssertionError("persisted time must not use wall time"); };

    @Test
    void scopedRunTimeWinsWhetherItIsEarlierOrLaterThanWallTime() {
        for (Instant at : List.of(EARLIER, WALL.plusSeconds(3600))) {
            ClaimClock clock = new RunClaimClock(() -> true, (environment, run) -> {
                assertEquals("env-1", environment);
                assertEquals("run-1", run);
                return Optional.of(new ClockReading(at, 1));
            }, NO_FALLBACK);
            assertEquals(at, clock.now(CONTEXT));
        }
    }

    @Test
    void anUnchangedRunStaysPausedAndAChangedRunIsReadAfresh() {
        AtomicReference<Instant> now = new AtomicReference<>(EARLIER);
        ClaimClock clock = new RunClaimClock(() -> true,
                (environment, run) -> Optional.of(new ClockReading(now.get(), 1)), NO_FALLBACK);
        assertEquals(EARLIER, clock.now(CONTEXT));
        assertEquals(EARLIER, clock.now(CONTEXT));
        now.set(EARLIER.plusSeconds(120));
        assertEquals(EARLIER.plusSeconds(120), clock.now(CONTEXT));
    }

    @Test
    void missingEmptyAndUnreadablePersistedClocksNeverBorrowWallTime() {
        for (RunClaimClock.Reader reader : List.<RunClaimClock.Reader>of(
                (environment, run) -> Optional.empty(), (environment, run) -> null,
                (environment, run) -> { throw new ClockUnavailableException("unreadable", new RuntimeException()); })) {
            ClaimClock clock = new RunClaimClock(() -> true, reader, NO_FALLBACK);
            assertThrows(RuntimeException.class, () -> clock.now(CONTEXT));
        }
    }

    @Test
    void persistenceOffRetainsTheExistingPolicyClockAndDoesNotReadTheRunClock() {
        ClaimClock fallback = new PolicyClaimClock(context -> {
            assertEquals(CONTEXT, context);
            return WALL;
        });
        ClaimClock clock = new RunClaimClock(() -> false, (environment, run) -> {
            throw new AssertionError("persistence-off must not query a run clock");
        }, fallback);
        assertEquals(WALL, clock.now(CONTEXT));
    }
}
