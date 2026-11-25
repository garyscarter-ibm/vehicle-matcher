package gcsp.api.scenario;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ScenarioCatalogueTest {

    private static final Set<String> CAPABILITIES = Set.of("brief-confirmation", "stock-release", "buddy-allocation",
            "buddy-offers", "captured-notifications", "offer-decisions", "brief-change", "order-handoff");

    private ScenarioCatalogue catalogue(Set<String> capabilities) {
        return ScenarioCatalogue.build(DemoPreparationFile.load(), "gcsp-policy-v1", "clock-v1", "fixtures-v1",
                "2026-11-25T09:00:00.000Z", JsonNodeFactory.instance.objectNode(), capabilities);
    }

    @Test
    void onlyMainHasAReviewedJourneyLoader() {
        ScenarioCatalogue catalogue = catalogue(CAPABILITIES);
        assertTrue(catalogue.find(MainJourneyStart.SCENARIO_ID).orElseThrow().available());
        for (var scenario : DemoPreparationFile.load().scenarios()) {
            var entry = catalogue.find(scenario.path("scenarioId").asText()).orElseThrow();
            if (!entry.mechanics() && !MainJourneyStart.SCENARIO_ID.equals(entry.scenarioId())) {
                assertFalse(entry.available());
                assertEquals(scenario.path("requiredCapabilities").size(), entry.missingCapabilities().size());
            }
        }
    }

    @Test
    void mainReportsOnlyTheActuallyMissingRequiredCapability() {
        for (String missing : CAPABILITIES) {
            Set<String> available = new HashSet<>(CAPABILITIES);
            available.remove(missing);
            var main = catalogue(available).find(MainJourneyStart.SCENARIO_ID).orElseThrow();
            assertFalse(main.available());
            assertEquals(java.util.List.of(missing), main.missingCapabilities());
        }
        assertTrue(catalogue(Set.of()).mechanics().available());
    }
}
