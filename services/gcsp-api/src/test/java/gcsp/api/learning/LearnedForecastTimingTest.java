package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import org.junit.jupiter.api.Test;

/** Records one cold artifact load and one warm forecast; the assertions are loose so a slow host does not flake. */
class LearnedForecastTimingTest {

    @Test
    void coldLoadAndWarmForecastAreCheap() {
        JsonNode cases = LearningFixtures.read(LearningFixtures.CASES).get("cases");
        JsonNode sample = null;
        for (JsonNode c : cases) if (c.get("name").textValue().equals("active/multi-cohort-multi-period")) sample = c;
        PolicyService policy = LearningFixtures.service(sample.get("spec"));
        ModelArtifacts store = new ModelArtifacts(new ClasspathArtifactStore());
        long t0 = System.nanoTime();
        ModelArtifact artifact = store.read(LearningFixtures.ID);
        long cold = System.nanoTime() - t0;
        LearnedDemandForecast forecast = new LearnedDemandForecast(policy, store);
        forecast.forecast(sample.get("input"), null);
        long start = System.nanoTime();
        ObjectNode body = forecast.forecast(sample.get("input"), null);
        long warm = System.nanoTime() - start;
        System.out.println("LEARNING-TIMING coldLoadMs=" + cold / 1_000_000.0 + " warmForecastMs=" + warm / 1_000_000.0);
        assertEquals("ok", body.get("status").textValue());
        assertEquals(LearningFixtures.ID, artifact.artifactId());
        assertTrue(warm < 2_000_000_000L, "warm forecast took " + warm + " ns");
    }
}
