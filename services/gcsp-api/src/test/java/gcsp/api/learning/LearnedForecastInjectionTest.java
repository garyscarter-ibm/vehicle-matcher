package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** The default profile injects the port over the classpath store; the seed has no reference row, so it falls back. */
@QuarkusTest
class LearnedForecastInjectionTest {

    @Inject
    LearnedDemandForecastPort port;

    @Test
    void defaultProfileStaysOnTheBaseline() {
        JsonNode sample = null;
        for (JsonNode c : LearningFixtures.read(LearningFixtures.CASES).get("cases")) {
            if (c.get("name").textValue().equals("fallback/no-reference-row")) sample = c;
        }
        JsonNode body = port.forecast(sample.get("input"), null);
        assertEquals("fallback", body.get("status").textValue());
        assertEquals("no-active-model", body.get("reason").textValue());
        assertEquals("No learned model is active, so only the baseline plan from expressed demand is shown.", body.get("limitation").textValue());
        assertEquals("invalid", port.forecast(null, null).get("status").textValue());
    }
}
