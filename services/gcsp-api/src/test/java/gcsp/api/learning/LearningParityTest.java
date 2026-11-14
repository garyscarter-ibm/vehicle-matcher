package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Every case in learning-parity/cases.json was produced by the Node provider over the same retained data. Numeric
 * bounds: per-employee probabilities 1e-12, aggregate expected/low/high 1e-9; everything else is exact.
 */
class LearningParityTest {

    static final double EMPLOYEE_BOUND = 1e-12;
    static final double AGGREGATE_BOUND = 1e-9;

    @TempDir
    Path dir;

    private double maxEmployee;
    private double maxAggregate;
    private final List<String> failures = new ArrayList<>();

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.textValue();
    }

    private static boolean employeeNumber(String path) {
        return path.matches("employees\\[\\d+]\\.(waitProbability|acceptanceProbability|choices\\[\\d+]\\.probability)");
    }

    private static boolean aggregateNumber(String path) {
        return path.matches("aggregate\\[\\d+]\\.(expected|low|high)");
    }

    /** Structural comparison: exact except for the bounded numbers; a path of the first difference is recorded. */
    private void compare(JsonNode expected, JsonNode actual, String path) {
        if (expected.isNumber() && actual != null && actual.isNumber()) {
            double e = expected.doubleValue();
            double a = actual.doubleValue();
            double bound = employeeNumber(path) ? EMPLOYEE_BOUND : aggregateNumber(path) ? AGGREGATE_BOUND : 0;
            double difference = Math.abs(e - a);
            if (employeeNumber(path)) maxEmployee = Math.max(maxEmployee, difference);
            if (aggregateNumber(path)) maxAggregate = Math.max(maxAggregate, difference);
            assertTrue(difference <= bound, path + ": expected " + e + " actual " + a);
            return;
        }
        assertTrue(actual != null, path + ": missing");
        if (expected.isObject()) {
            assertTrue(actual.isObject(), path + ": not an object");
            Set<String> expectedKeys = new TreeSet<>();
            expected.fieldNames().forEachRemaining(expectedKeys::add);
            Set<String> actualKeys = new TreeSet<>();
            actual.fieldNames().forEachRemaining(actualKeys::add);
            assertEquals(expectedKeys, actualKeys, path + ": keys");
            for (Iterator<Map.Entry<String, JsonNode>> it = expected.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> entry = it.next();
                compare(entry.getValue(), actual.get(entry.getKey()), path.isEmpty() ? entry.getKey() : path + "." + entry.getKey());
            }
        } else if (expected.isArray()) {
            assertTrue(actual.isArray(), path + ": not an array");
            assertEquals(expected.size(), actual.size(), path + ": length");
            for (int i = 0; i < expected.size(); i++) compare(expected.get(i), actual.get(i), path + "[" + i + "]");
        } else {
            assertEquals(expected, actual, path);
        }
    }

    /** Per-employee ranking of choices by probability, ties by derivativeId. */
    private static List<String> ranking(JsonNode choices) {
        List<JsonNode> sorted = new ArrayList<>();
        choices.forEach(sorted::add);
        sorted.sort(Comparator.<JsonNode>comparingDouble(c -> -c.get("probability").doubleValue()).thenComparing(c -> c.get("derivativeId").textValue()));
        return sorted.stream().map(c -> c.get("derivativeId").textValue()).toList();
    }

    private static List<LearnedNarrowing.Choice> choices(JsonNode node) {
        List<LearnedNarrowing.Choice> out = new ArrayList<>();
        node.forEach(c -> out.add(new LearnedNarrowing.Choice(c.get("derivativeId").textValue(), c.get("probability").doubleValue())));
        return out;
    }

    private void forecast(JsonNode c, Map<String, ModelArtifacts> stores) {
        JsonNode policyRead = c.get("policyRead");
        PolicyRead read = policyRead == null || policyRead.isNull() ? null
                : new PolicyRead(text(policyRead, "runId"), text(policyRead, "asOf"), text(policyRead, "policyVersion"));
        LearnedDemandForecast forecast = new LearnedDemandForecast(LearningFixtures.service(c.get("spec")), stores.get(c.get("artifact").textValue()));
        ObjectNode actual = forecast.forecast(c.get("input"), read);
        JsonNode expected = c.get("expected");
        compare(expected, actual, "");
        if (!"ok".equals(expected.get("status").textValue())) return;
        double waitThreshold = expected.get("settings").get("waitExclusionThreshold").doubleValue();
        double massThreshold = expected.get("settings").get("choiceMassThreshold").doubleValue();
        JsonNode narrowing = c.get("narrowing");
        for (int i = 0; i < narrowing.size(); i++) {
            JsonNode node = narrowing.get(i);
            JsonNode employee = actual.get("employees").get(i);
            assertEquals(node.get("entitlementId"), employee.get("entitlementId"), "entitlement order");
            assertEquals(ranking(expected.get("employees").get(i).get("choices")), ranking(employee.get("choices")), "ranking " + i);
            assertEquals(node.get("waits").booleanValue(), LearnedNarrowing.expectsWait(employee.get("waitProbability").doubleValue(), waitThreshold), "wait " + i);
            List<String> kept = new ArrayList<>();
            node.get("kept").forEach(k -> kept.add(k.textValue()));
            assertEquals(kept, LearnedNarrowing.likeliest(choices(employee.get("choices")), massThreshold), "kept " + i);
        }
    }

    private void featureVector(JsonNode c) {
        JsonNode expected = c.get("expected");
        JsonNode alternative = c.get("alternative");
        try {
            double[] vector = ChoiceFeatures.featureVector(alternative.get("attributes"), alternative.path("isWait").asBoolean(false),
                    c.get("brief"), c.get("featureVersion").textValue());
            assertTrue(expected.has("vector"), "expected an error " + expected);
            JsonNode node = expected.get("vector");
            assertEquals(node.size(), vector.length);
            for (int i = 0; i < vector.length; i++) {
                double e = node.get(i).doubleValue();
                // Feature values are plain IEEE arithmetic on the inputs, so they are exact.
                assertTrue(Double.doubleToLongBits(e) == Double.doubleToLongBits(vector[i]) || e == vector[i], "feature " + i + ": " + e + " vs " + vector[i]);
            }
        } catch (ChoiceModelException e) {
            assertTrue(expected.has("error"), "unexpected error " + e.getMessage());
            assertEquals(expected.get("error").get("code").textValue(), e.code());
            assertEquals(expected.get("error").get("field").textValue(), e.field());
        }
    }

    private void probabilities(JsonNode c) {
        List<double[]> alternatives = new ArrayList<>();
        c.get("alternatives").forEach(a -> {
            double[] f = new double[a.size()];
            for (int i = 0; i < f.length; i++) f[i] = a.get(i).doubleValue();
            alternatives.add(f);
        });
        double[] coefficients = new double[c.get("coefficients").size()];
        for (int i = 0; i < coefficients.length; i++) coefficients[i] = c.get("coefficients").get(i).doubleValue();
        double[] actual = ChoiceModel.probabilities(alternatives, coefficients);
        JsonNode expected = c.get("expected");
        assertEquals(expected.size(), actual.length);
        for (int i = 0; i < actual.length; i++) {
            double difference = Math.abs(expected.get(i).doubleValue() - actual[i]);
            maxEmployee = Math.max(maxEmployee, difference);
            assertTrue(difference <= EMPLOYEE_BOUND, "probability " + i);
        }
    }

    @Test
    void javaMatchesEveryNodeOutcome() throws IOException {
        JsonNode file = LearningFixtures.read(LearningFixtures.CASES);
        JsonNode cases = file.get("cases");
        assertTrue(cases.size() >= 150, "case count " + cases.size());
        assertTrue(file.get("generator").get("gitShortSha").textValue().length() >= 7);
        Map<String, Path> dirs = LearningFixtures.artifactDirectories(file.get("retained"), dir);
        Map<String, ModelArtifacts> stores = new HashMap<>();
        dirs.forEach((name, path) -> stores.put(name, new ModelArtifacts(new DirectoryArtifactStore(path.toAbsolutePath().normalize()))));
        Map<String, Integer> byKind = new HashMap<>();
        for (JsonNode c : cases) {
            byKind.merge(c.get("kind").textValue(), 1, Integer::sum);
            try {
                switch (c.get("kind").textValue()) {
                    case "forecast" -> forecast(c, stores);
                    case "featureVector" -> featureVector(c);
                    case "probabilities" -> probabilities(c);
                    case "likeliest" -> {
                        List<String> expected = new ArrayList<>();
                        c.get("expected").forEach(k -> expected.add(k.textValue()));
                        assertEquals(expected, LearnedNarrowing.likeliest(choices(c.get("choices")), c.get("threshold").doubleValue()));
                    }
                    case "waitExclusion" -> assertEquals(c.get("expected").booleanValue(),
                            LearnedNarrowing.expectsWait(c.get("probability").doubleValue(), c.get("threshold").doubleValue()));
                    default -> throw new AssertionError("unknown kind " + c.get("kind"));
                }
            } catch (AssertionError | RuntimeException e) {
                failures.add(c.get("name").textValue() + ": " + e.getMessage());
            }
        }
        System.out.println("LEARNING-PARITY cases=" + byKind + " maxEmployeeDiff=" + maxEmployee + " maxAggregateDiff=" + maxAggregate);
        assertTrue(failures.isEmpty(), failures.size() + " failed:\n" + String.join("\n", failures.subList(0, Math.min(15, failures.size()))));
        assertTrue(maxEmployee <= EMPLOYEE_BOUND && maxAggregate <= AGGREGATE_BOUND);
    }
}
