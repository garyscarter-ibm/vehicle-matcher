package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;
import static gcsp.api.comparison.ComparisonRunnerSupport.copy;
import static gcsp.api.comparison.ComparisonRunnerSupport.fixture;
import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static gcsp.api.comparison.ComparisonRunnerSupport.sameJson;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyRead;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class ComparisonMeasuresTest {

    private static JsonNode rule() {
        return POLICY.getAssumption(ComparisonMeasures.RULE_KEY,
                new PolicyRead("measures-test", "2026-11-05T09:00:00.000Z", null)).value();
    }

    private static ArrayNode rows(JsonNode perSeed, String left, String right, String l, String r) {
        ArrayNode out = JsonNodeFactory.instance.arrayNode();
        for (JsonNode entry : perSeed) {
            ObjectNode row = out.addObject();
            row.set("seed", entry.get("seed"));
            row.set(l, entry.get("routes").get(left).get("measures"));
            row.set(r, entry.get("routes").get(right).get("measures"));
        }
        return out;
    }

    private static void assertRefused(JsonNode expected, Runnable action, String name) {
        ComparisonRunError error = assertThrows(ComparisonRunError.class, action::run, name);
        assertEquals(expected.get("refused").get("code").textValue(), error.code(), name);
        assertEquals(expected.get("refused").get("boundary").textValue(), error.boundary(), name);
    }

    @Test
    void routeMeasuresMatchNodeForTheCommittedRecordsAndMutations() throws IOException {
        JsonNode current = fixture("gcsp-comparison-current-outcomes.json").get("outcomeRecord");
        JsonNode buddy = fixture("gcsp-comparison-buddy-outcomes.json").get("outcomeRecord");
        int checked = 0;
        for (JsonNode c : golden().get("measures")) {
            String name = c.get("name").textValue();
            ObjectNode record = copy(c.get("source").textValue().equals("buddy") ? buddy : current);
            switch (c.has("mutation") ? c.get("mutation").textValue() : "") {
                case "no-employees" -> record.putArray("employees");
                case "below-threshold" -> {
                    for (JsonNode row : record.get("employees")) {
                        if (row.get("fit") != null && row.get("fit").isObject()) {
                            ((ObjectNode) row.get("fit")).put("underlying", record.get("threshold").doubleValue() - 1);
                        }
                    }
                }
                case "unknown-route" -> record.put("route", "other");
                case "no-totals" -> record.remove("totals");
                default -> { }
            }
            JsonNode expected = c.get("expected");
            if (expected.has("refused")) {
                assertRefused(expected, () -> ComparisonMeasures.routeMeasures(record), name);
            } else {
                sameJson(expected.get("ok"), ComparisonMeasures.routeMeasures(record), name);
            }
            checked++;
        }
        assertEquals(golden().get("measures").size(), checked);
    }

    @Test
    void compareRoutesAndArmsMatchNodeVerdictsAndRefusals() throws IOException {
        for (JsonNode c : golden().get("comparisons")) {
            String name = c.get("name").textValue();
            JsonNode perSeed = c.get("perSeed");
            ArrayNode arms = JsonNodeFactory.instance.arrayNode();
            for (JsonNode seed : perSeed) {
                ObjectNode row = arms.addObject();
                row.set("seed", seed.get("seed"));
                row.set("baseline", seed.get("current"));
                row.set("variant", seed.get("buddy"));
            }
            check(c.get("routes"), () -> ComparisonMeasures.compareRoutes(perSeed, c.get("rule")), name + " routes");
            check(c.get("arms"), () -> ComparisonMeasures.compareArms(arms, c.get("rule")), name + " arms");
        }
    }

    private static void check(JsonNode expected, java.util.function.Supplier<ArrayNode> actual, String name) {
        if (expected.has("refused")) {
            assertRefused(expected, actual::get, name);
        } else {
            ArrayNode result = actual.get();
            assertEquals(expected.get("entries").intValue(), result.size(), name);
            assertEquals(expected.get("digest").textValue(), CanonicalJson.digest(result), name);
        }
    }

    @Test
    void retainedProcessResultMeasuresAndDifferencesRecompute() throws IOException {
        JsonNode result = ComparisonRunnerSupport.retainedProcess();
        JsonNode perSeed = result.get("perSeed");
        for (String route : new String[] { "current", "buddy" }) {
            sameJson(result.get("measures").get(route), ComparisonMeasures.routeSummary(perSeed, route), "measures " + route);
        }
        sameJson(result.get("differences"),
                ComparisonMeasures.compareRoutes(rows(perSeed, "current", "buddy", "current", "buddy"), result.get("rule")),
                "differences");
    }

    @Test
    void retainedHoldSweepArmsAndEffectsRecompute() throws IOException {
        JsonNode result = fixture("gcsp-comparison-experiment-result.json").get("storedResult").get("result");
        JsonNode ruleRow = result.get("rule");
        JsonNode baseline = result.get("arms").get(0).get("perSeed");
        for (JsonNode arm : result.get("arms")) {
            String id = arm.get("armId").textValue();
            JsonNode perSeed = arm.get("perSeed");
            for (String route : new String[] { "current", "buddy" }) {
                sameJson(arm.get("measures").get(route), ComparisonMeasures.routeSummary(perSeed, route), id + " measures " + route);
            }
            sameJson(arm.get("differences"),
                    ComparisonMeasures.compareRoutes(rows(perSeed, "current", "buddy", "current", "buddy"), ruleRow), id + " differences");
        }
        for (int index = 0; index < result.get("effects").size(); index++) {
            JsonNode effect = result.get("effects").get(index);
            JsonNode variant = result.get("arms").get(index + 1).get("perSeed");
            for (String route : new String[] { "current", "buddy" }) {
                ArrayNode pairs = JsonNodeFactory.instance.arrayNode();
                for (int s = 0; s < baseline.size(); s++) {
                    ObjectNode row = pairs.addObject();
                    row.set("seed", baseline.get(s).get("seed"));
                    row.set("baseline", baseline.get(s).get("routes").get(route).get("measures"));
                    row.set("variant", variant.get(s).get("routes").get(route).get("measures"));
                }
                sameJson(effect.get("routes").get(route), ComparisonMeasures.compareArms(pairs, ruleRow),
                        effect.get("armId").textValue() + " effect " + route);
            }
        }
    }
}
