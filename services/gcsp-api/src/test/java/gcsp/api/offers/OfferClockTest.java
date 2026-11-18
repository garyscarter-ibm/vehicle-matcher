package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.WallPolicyClock;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class OfferClockTest {

    static final RunContext CTX = new RunContext("env", "run-1", "e");
    static final Instant RUN = Instant.parse("2026-11-05T09:00:00Z");
    static final Instant BOUND = Instant.parse("2030-01-01T00:00:00Z");

    @Test
    void theDefaultWallClockYieldsToTheRunClock() {
        OfferClock clock = new OfferClock(new WallPolicyClock(), ctx -> Optional.of(RUN));
        assertEquals(RUN, clock.now(CTX));
    }

    @Test
    void aRunWithoutAReadableClockIsUnavailableNotWallTime() {
        assertNull(new OfferClock(new WallPolicyClock(), ctx -> Optional.empty()).now(CTX));
    }

    @Test
    void aBoundPolicyClockIsHonouredOverTheRunClock() {
        PolicyClock bound = ctx -> BOUND;
        assertEquals(BOUND, new OfferClock(bound, ctx -> Optional.of(RUN)).now(CTX));
        assertEquals(BOUND, new OfferClock(bound, ctx -> Optional.empty()).now(CTX));
    }

    @Test
    void withoutPersistenceThePolicyClockAnswers() {
        PolicyClock wall = new WallPolicyClock();
        Instant before = Instant.now();
        Instant got = new OfferClock(wall, null).now(CTX);
        assertEquals(true, !got.isBefore(before) && !got.isAfter(Instant.now()));
    }
}
