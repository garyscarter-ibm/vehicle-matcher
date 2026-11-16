package gcsp.api.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The startup rule for the Production provider: no silent fallback, an unknown name stops startup. */
class ProductionSelectionTest {

    @Test
    void defaultIsNoneAndNeedsNoDatabase() {
        for (String name : new String[] {null, "", "  ", "none"}) {
            assertEquals("none", ProductionSelection.select(name));
        }
        ProductionProviderPort p = ProductionSelection.provider("none", () -> {
            throw new AssertionError("none needs no database");
        });
        assertInstanceOf(UnconfiguredProductionProvider.class, p);
    }

    @Test
    void knownNamesAreAccepted() {
        assertEquals("synthetic", ProductionSelection.select(" synthetic "));
        assertEquals("live-stub", ProductionSelection.select("live-stub"));
        assertInstanceOf(LiveProductionProviderStub.class, ProductionSelection.provider("live-stub", () -> {
            throw new AssertionError("live-stub needs no database");
        }));
    }

    @Test
    void anUnknownNameStopsStartupAndNamesTheSupportedValues() {
        for (String bad : new String[] {"live", "Synthetic", "tranche-plan", "off"}) {
            IllegalStateException e = assertThrows(IllegalStateException.class, () -> ProductionSelection.select(bad));
            assertTrue(e.getMessage().contains("none, synthetic, live-stub"), e.getMessage());
        }
    }

    @Test
    void syntheticWithoutADatabaseIsUnavailableNotGuessed() {
        ProductionProviderPort p = ProductionSelection.provider("synthetic", () -> {
            throw new IllegalStateException("Persistence is not configured");
        });
        assertEquals("none", p.mode());
    }
}
