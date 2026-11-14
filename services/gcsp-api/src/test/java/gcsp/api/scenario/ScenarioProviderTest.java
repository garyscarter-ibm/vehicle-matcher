package gcsp.api.scenario;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ScenarioProviderTest {

    @Test
    void noneIsTheDefaultAndDemoIsAccepted() {
        assertEquals("none", ScenarioProvider.normalise(null));
        assertEquals("none", ScenarioProvider.normalise(" "));
        assertEquals("none", ScenarioProvider.normalise("none"));
        assertEquals("demo", ScenarioProvider.normalise(" demo "));
    }

    @Test
    void anUnknownProviderStopsSelection() {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> ScenarioProvider.normalise("synthetic"));
        assertEquals("Unknown gcsp.scenario.provider 'synthetic'; supported: none, demo", e.getMessage());
    }

    @Test
    void thePackagedPreparationFileIsValidAndFictional() {
        DemoPreparationFile file = DemoPreparationFile.load();
        assertEquals("demo-preparation-v1", file.preparationVersion());
        assertEquals(5, file.principals().size());
        assertEquals(9, file.scenarios().size());
        assertEquals(1, file.scenarios().stream().filter(s -> "mechanics".equals(s.get("kind").textValue())).count());
    }
}
