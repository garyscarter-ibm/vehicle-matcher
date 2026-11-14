package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.RunContext;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** The default profile (no database): every port resolves to its default and the holder yields no service. */
@QuarkusTest
class ClaimWiringTest {

    @Inject
    ManualClaimsHolder holder;

    @Inject
    ManualSelectionPort selection;

    @Inject
    SlotOccupancyPort occupancy;

    @Inject
    ClaimTimingPort timing;

    @Inject
    ClaimClock clock;

    @Test
    void theDefaultsAreTheUnconfiguredPortsAndThePolicyBackedTimingAndClock() throws Exception {
        ClaimScope scope = new ClaimScope("env", "run-1", "actor", "e1", "gcsp-policy-v1");
        assertEquals("manual-selection-not-configured",
                assertInstanceOf(ManualSelectionPort.NoClaimant.class, selection.claimant(scope)).code());
        assertEquals("manual-selection-not-configured",
                assertInstanceOf(ManualSelectionPort.NoDecision.class, selection.decide(scope, "car-1")).code());
        assertTrue(occupancy.heldOfferId(null, "hold-1").isEmpty());
        assertInstanceOf(ClaimTimingPort.Known.class, timing.timing(scope, Instant.parse("2026-11-13T09:00:00Z")));
        assertTrue(clock.now(new RunContext("env", "run-1", "actor")).isAfter(Instant.parse("2026-01-01T00:00:00Z")));
        assertFalse(holder.claims().isPresent());
    }
}
