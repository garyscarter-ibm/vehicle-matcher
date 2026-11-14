package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;
import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static gcsp.api.comparison.ComparisonRunnerSupport.sameJson;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class ComparisonExperimentsTest {

    @Test
    void preparationMatchesNodePlansAndRefusals() throws IOException {
        JsonNode golden = golden();
        String now = golden.get("now").textValue();
        int plans = 0;
        int refusals = 0;
        for (JsonNode c : golden.get("preparation")) {
            String name = c.get("name").textValue();
            JsonNode expected = c.get("expected");
            if (expected.has("refused")) {
                ComparisonRunError error = assertThrows(ComparisonRunError.class,
                        () -> ComparisonExperiments.prepare(c.get("experiment"), POLICY, now), name);
                assertEquals(expected.get("refused").get("code").textValue(), error.code(), name);
                assertEquals(expected.get("refused").get("boundary").textValue(), error.boundary(), name);
                refusals++;
            } else {
                ComparisonExperiments.Prepared prepared = ComparisonExperiments.prepare(c.get("experiment"), POLICY, now);
                sameJson(expected.get("ok"), prepared.plan().toJson(), name);
                plans++;
            }
        }
        assertEquals(7, plans);
        assertEquals(golden.get("preparation").size() - 7, refusals);
    }

    @Test
    void preparedWhatIfCarriesTheRowsAndChangeInfo() throws IOException {
        JsonNode golden = golden();
        for (JsonNode c : golden.get("preparation")) {
            if (!c.get("name").textValue().equals("hold-valid")) continue;
            ComparisonExperiments.Prepared prepared = ComparisonExperiments.prepare(c.get("experiment"), POLICY, golden.get("now").textValue());
            assertNotNull(prepared.definitionRow());
            assertEquals("comparison.experiments.v1", prepared.changeInfo().get("definitionKey").textValue());
            assertEquals("what-if", prepared.changeInfo().get("status").textValue());
            assertEquals(7200, prepared.changeInfo().get("baselineValue").intValue());
            assertEquals(3, prepared.plan().arms().size());
            assertEquals(18, prepared.plan().steps());
        }
        JsonNode process = golden.get("preparation").get(0).get("experiment");
        ComparisonExperiments.Prepared plain = ComparisonExperiments.prepare(process, POLICY, golden.get("now").textValue());
        assertNull(plain.changeInfo());
        assertNull(plain.definitionRow());
        assertEquals(6, plain.plan().steps());
    }
}
