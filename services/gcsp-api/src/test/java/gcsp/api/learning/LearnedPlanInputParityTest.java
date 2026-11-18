package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.PlanningRead;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** Node-generated input outcomes replay with exact model features, terms pins and refusals. */
class LearnedPlanInputParityTest {
    @Test void predictionInputMatchesNodeIncludingExplicitNullsAndMissingEvidence() {
        JsonNode file = LearningFixtures.read(Path.of("src/test/resources/learning-parity/plan-input-cases.json"));
        int count = 0;
        for (JsonNode c : file.path("cases")) {
            JsonNode read = c.get("read");
            PlanningRead pin = new PlanningRead(new RunContext("env-parity", read.path("runId").asText(), "greg"),
                    read.path("asOf").asText(), read.path("policyVersion").asText(), read.path("horizonEnd").asText());
            JsonNode actual = LearnedPredictionInput.create(c.get("expressed"), c.get("catalog"), pin, LearningFixtures.service(null));
            assertEquals(CanonicalJson.canonical(c.get("expected")), CanonicalJson.canonical(actual), c.path("name").asText());
            count++;
        }
        assertTrue(count >= 13);
    }
}
