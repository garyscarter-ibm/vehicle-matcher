package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;
import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static gcsp.api.comparison.ComparisonRunnerSupport.sameJson;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ComparisonRunnerTest {

    /** Returns the Node record recorded for (armId, seed, route); the real replay is not part of this slice. */
    private static ComparisonReplay recorded(JsonNode golden, JsonNode run, List<String> asked) {
        Map<String, JsonNode> byStep = new HashMap<>();
        for (JsonNode entry : run.get("records")) {
            ObjectNode record = golden.get("recordPool").get(entry.get("record").intValue()).deepCopy();
            ArrayNode assumptions = record.putArray("assumptions");
            for (JsonNode index : golden.get("recordPool").get(entry.get("record").intValue()).get("assumptions")) {
                assumptions.add(golden.get("assumptionPool").get(index.intValue()));
            }
            byStep.put(entry.get("armId").textValue() + "|" + entry.get("seed").textValue() + "|" + entry.get("route").textValue(), record);
        }
        return request -> {
            String key = request.arm().armId() + "|" + request.seed().textValue() + "|" + request.route();
            asked.add(key + "|" + request.pointsMultiplier());
            return byStep.get(key);
        };
    }

    @Test
    void fullRunsReplayedFromNodeRecordsMatchNodeResultsAndProgress() throws IOException {
        JsonNode golden = golden();
        String now = golden.get("now").textValue();
        for (JsonNode run : golden.get("runs")) {
            String name = run.get("name").textValue();
            List<String> asked = new ArrayList<>();
            List<JsonNode> progress = new ArrayList<>();
            ObjectNode result = ComparisonRunner.run(run.get("experiment"), POLICY, recorded(golden, run, asked), "parity",
                    () -> now, step -> progress.add(step.toJson()));
            assertEquals(run.get("resultDigest").textValue(), CanonicalJson.digest(result), name);
            ArrayNode expected = JsonNodeFactory.instance.arrayNode().addAll((ArrayNode) run.get("progress"));
            ArrayNode actual = JsonNodeFactory.instance.arrayNode();
            progress.forEach(actual::add);
            sameJson(expected, actual, name + " progress");
            assertEquals(run.get("records").size(), asked.size(), name);
            assertEquals(run.get("result").get("arms").intValue(), result.has("arms") ? result.get("arms").size() : 0, name);
            assertEquals(run.get("result").get("effects").intValue(), result.has("effects") ? result.get("effects").size() : 0, name);
        }
    }

    @Test
    void theHoldSweepIsAskedForTheArmMultiplier() throws IOException {
        JsonNode golden = golden();
        JsonNode run = golden.get("runs").get(1);
        List<String> asked = new ArrayList<>();
        ComparisonRunner.run(run.get("experiment"), POLICY, recorded(golden, run, asked), "parity",
                () -> golden.get("now").textValue(), null);
        assertTrue(asked.stream().allMatch(step -> step.endsWith("|1.0")), asked.toString());
        assertEquals("baseline|parity-a|current|1.0", asked.get(0));
        assertEquals("hold-900|parity-a|current|1.0", asked.get(2));
    }

    @Test
    void aMismatchedRecordIsRefusedAsAnOutcomeRecord() throws IOException {
        JsonNode golden = golden();
        JsonNode run = golden.get("runs").get(0);
        ComparisonReplay good = recorded(golden, run, new ArrayList<>());
        ComparisonReplay wrongRoute = request -> {
            ObjectNode record = good.replay(request).deepCopy();
            record.put("route", request.route().equals("current") ? "buddy" : "current");
            return record;
        };
        ComparisonRunError error = assertThrows(ComparisonRunError.class, () -> ComparisonRunner.run(run.get("experiment"),
                POLICY, wrongRoute, "parity", () -> golden.get("now").textValue(), null));
        assertEquals("outcome-record", error.boundary());
        ComparisonReplay wrongHash = request -> {
            ObjectNode record = good.replay(request).deepCopy();
            record.put("inputHash", "0".repeat(64));
            return record;
        };
        assertEquals("outcome-record", assertThrows(ComparisonRunError.class, () -> ComparisonRunner.run(run.get("experiment"),
                POLICY, wrongHash, "parity", () -> golden.get("now").textValue(), null)).boundary());
    }

    @Test
    void theUnavailableReplayThrowsOnTheFirstStepWithoutProgress() throws IOException {
        JsonNode golden = golden();
        List<JsonNode> progress = new ArrayList<>();
        ComparisonUnavailable error = assertThrows(ComparisonUnavailable.class,
                () -> ComparisonRunner.run(golden.get("runs").get(0).get("experiment"), POLICY, new UnavailableComparisonReplay(),
                        "parity", () -> golden.get("now").textValue(), step -> progress.add(step.toJson())));
        assertEquals("The route replay is not available in this service yet.", error.reason());
        assertEquals(List.of("allocation (FUCQ-464)", "recommendation (FUCQ-461)"), error.bindings());
        assertTrue(progress.isEmpty());
    }

    @Test
    void anInvalidRequestIsRefusedBeforeAnyReplay() {
        ObjectNode experiment = JsonNodeFactory.instance.objectNode().put("experimentId", "points");
        ComparisonReplay never = request -> {
            throw new AssertionError("no replay for a refused request");
        };
        ComparisonRunError error = assertThrows(ComparisonRunError.class, () -> ComparisonRunner.run(experiment, POLICY, never,
                "parity", () -> "2026-11-08T12:00:00.000Z", null));
        assertEquals("change", error.boundary());
    }
}
