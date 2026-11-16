package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static gcsp.api.comparison.ComparisonRunnerSupport.sameJson;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class ComparisonRequestsTest {

    @Test
    void parseMatchesNodeForEveryBody() throws IOException {
        int checked = 0;
        for (JsonNode c : golden().get("requests")) {
            ComparisonRequests.Outcome outcome = ComparisonRequests.parse(c.get("body"));
            sameJson(c.get("expected"), outcome.body(), c.get("name").textValue());
            checked++;
        }
        assertEquals(golden().get("requests").size(), checked);
    }

    @Test
    void refusalForMatchesNodeForEveryBoundary() throws IOException {
        for (JsonNode c : golden().get("refusals")) {
            ComparisonRequests.Outcome outcome = ComparisonRequests.refusalFor(c.get("boundary").textValue(),
                    c.get("experimentId").textValue(), c.get("change"));
            sameJson(c.get("expected"), outcome.body(), c.get("boundary").textValue() + " " + c.get("experimentId").textValue());
        }
    }

    @Test
    void userFacingTextHasNoEmDashes() throws IOException {
        for (JsonNode c : golden().get("refusals")) {
            assertFalse(c.get("expected").toString().contains("\u2014"));
        }
        for (JsonNode c : golden().get("requests")) {
            ComparisonRequests.Outcome outcome = ComparisonRequests.parse(c.get("body"));
            assertFalse(outcome.body().toString().contains("\u2014"), c.get("name").textValue());
        }
    }

    @Test
    void refusedBoundaryReadsRunAndInputErrors() {
        assertEquals("overlay", ComparisonRequests.refusedBoundary(new ComparisonRunError("invalid-input", "overlay")));
        assertEquals("seed", ComparisonRequests.refusedBoundary(new ComparisonInputError("invalid-seed", "seed")));
        assertNull(ComparisonRequests.refusedBoundary(new ComparisonRunError("unavailable", "comparison.startsAt")));
        assertNull(ComparisonRequests.refusedBoundary(new ComparisonInputError("policy-unavailable", "x")));
        assertTrue(ComparisonRequests.parse(ComparisonRunnerSupport.MAPPER.createObjectNode().put("experimentId", "process-only")).ok());
    }
}
