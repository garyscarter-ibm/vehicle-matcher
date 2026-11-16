package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/** Replays the Node-generated cases (recommendation-scoring-parity.mjs) against the Java port; never runs Node. */
class ScoringParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String NOW = "2026-11-05T12:00:00.000Z";
    private static final double BOUND = 1e-9;
    private static final int FLOOR = 1500;
    /** Values that are displayed, drive a decision or echo an input must match exactly, not within the bound. */
    private static final Set<String> EXACT = Set.of("score", "observed", "desired", "facts", "fact", "requirement", "preference",
            "value", "importance", "unit");

    private double maxDiff;
    private long compared;
    private long nonFaultThrows;

    @Test
    void javaMatchesTheNodeDecisionPrimitives() throws IOException {
        JsonNode seed = MAPPER.readTree(Files.readAllBytes(Path.of("../../server/gcsp/policy/seed-v1.json")));
        JsonNode value = null;
        for (JsonNode row : seed.get("assumptions")) if ("employee.recommendation.v1".equals(row.get("key").textValue())) value = row.get("value");
        assertTrue(value != null, "seeded recommendation assumption");
        JsonNode cases;
        try (InputStream in = getClass().getResourceAsStream("/recommendation-parity/scoring-cases.json")) {
            cases = MAPPER.readTree(in);
        }
        assertTrue(cases.size() > FLOOR, "case count " + cases.size() + " is above " + FLOOR);
        List<String> failures = new ArrayList<>();
        int thrown = 0;
        for (JsonNode c : cases) {
            String name = c.get("name").textValue();
            JsonNode expected = expand(c.get("expected"), value);
            if (expected != null && expected.isObject() && expected.size() == 1 && expected.has("throws")) thrown++;
            try {
                JsonNode actual = run(c.get("fn").textValue(), c.get("args"), value);
                String diff = diff(name, c.get("fn").textValue(), "$", expected, actual);
                if (diff != null) failures.add(name + " -> " + diff);
            } catch (RuntimeException e) {
                if (!(e instanceof RecommendationFault)) {
                    nonFaultThrows++;
                    failures.add(name + " -> non-fault throw " + e);
                }
                String diff = diff(name, c.get("fn").textValue(), "$", expected, throwsMarker());
                if (diff != null) failures.add(name + " -> Java threw " + e + " but Node returned " + abbreviate(expected));
            }
        }
        System.out.printf("Scoring parity: %d cases (%d expect a throw), %d numbers compared, max absolute numeric difference %s, "
                + "%d throws not RecommendationFault%n", cases.size(), thrown, compared, maxDiff, nonFaultThrows);
        if (!failures.isEmpty()) {
            fail(failures.size() + " parity failures; first:\n" + String.join("\n", failures.subList(0, Math.min(15, failures.size()))));
        }
        assertEquals(0, nonFaultThrows, "every Java throw is a RecommendationFault");
        assertTrue(maxDiff <= BOUND, "numeric difference " + maxDiff);
    }

    // ---- dispatch -------------------------------------------------------------------------------------------

    private static final ObjectNode THROWS = F.objectNode();

    static {
        THROWS.put("throws", true);
    }

    private static JsonNode throwsMarker() {
        return THROWS;
    }

    private static JsonNode run(String fn, JsonNode rawArgs, JsonNode seed) {
        List<JsonNode> a = new ArrayList<>();
        for (JsonNode arg : rawArgs) a.add(expand(arg, seed));
        while (a.size() < 5) a.add(null);
        return switch (fn) {
            case "confirmedFact" -> F.booleanNode(Gates.confirmedFact(a.get(0), config(a.get(1))));
            case "unselectedPracticalAnswer" -> F.booleanNode(Gates.unselectedPracticalAnswer(a.get(0)));
            case "unselectedPreference" -> F.booleanNode(Gates.unselectedPreference(a.get(0)));
            case "chargingGates" -> Gates.chargingGates(a.get(0), a.get(1), config(a.get(2)), Js.truthy(a.get(3))).toJson();
            case "validateBrief" -> BriefRules.validateBrief(a.get(0), config(a.get(1)), Slider.from(a.get(2)));
            case "validateBriefContent" -> BriefRules.validateBriefContent(a.get(0), config(a.get(1)), Slider.from(a.get(2)));
            case "validChoice" -> F.booleanNode(BriefRules.validChoice(a.get(0), a.get(1)));
            case "choiceList" -> BriefRules.choiceList(a.get(0));
            case "intentValue" -> BriefRules.intentValue(a.get(0));
            case "evaluateEssentials" -> Gates.evaluateEssentials(a.get(0), a.get(1), config(a.get(2)),
                    a.get(3) != null && Js.truthy(a.get(3).get("optionalDefaults"))).toJson();
            case "scorePreferences" -> PreferenceScoring.score(a.get(0), a.get(1), a.get(2), config(a.get(3)), Slider.from(a.get(4)));
            case "scoreOptionEvidence" -> {
                OptionEvidence.Result r = OptionEvidence.score(a.get(0), a.get(1), a.get(2));
                yield r == null ? F.nullNode() : r.toJson();
            }
            case "rankEmployeeRecommendations" -> {
                ArrayNode out = F.arrayNode();
                Ranking.rank(list(a.get(0)), config(a.get(1))).forEach(out::add);
                yield out;
            }
            case "configurationValid" -> F.booleanNode(config(a.get(0)).valid(Slider.from(a.get(1))));
            default -> throw new IllegalArgumentException("unknown function " + fn);
        };
    }

    private static List<JsonNode> list(JsonNode n) {
        if (n == null || !n.isArray()) throw new RecommendationFault("decisions.filter is not a function");
        List<JsonNode> out = new ArrayList<>();
        n.forEach(out::add);
        return out;
    }

    private static RecommendationConfig config(JsonNode n) {
        return new RecommendationConfig(n);
    }

    // ---- placeholders ---------------------------------------------------------------------------------------

    /** Expands {$seed}, {$fact} and {$undefined}; the latter returns a Java null reference. */
    private static JsonNode expand(JsonNode n, JsonNode seed) {
        if (n == null) return null;
        if (n.isArray()) {
            ArrayNode out = F.arrayNode();
            for (JsonNode e : n) out.add(expandOrNull(e, seed));
            return out;
        }
        if (!n.isObject()) return n;
        if (n.has("$undefined")) return null;
        if (n.has("$fact")) return fact(n.get("$fact"));
        if (n.has("$seed")) return seedRef(n.get("$seed"), seed);
        ObjectNode out = F.objectNode();
        for (Iterator<Map.Entry<String, JsonNode>> it = n.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            out.set(e.getKey(), expandOrNull(e.getValue(), seed));
        }
        return out;
    }

    private static JsonNode expandOrNull(JsonNode n, JsonNode seed) {
        JsonNode v = expand(n, seed);
        return v == null ? F.nullNode() : v;
    }

    private static JsonNode fact(JsonNode spec) {
        JsonNode value = spec.get(0);
        JsonNode unit = spec.size() > 1 ? spec.get(1) : F.nullNode();
        String assurance = spec.size() > 2 ? spec.get(2).textValue() : value.isNull() ? "unknown" : "synthetic-scenario";
        ObjectNode provenance = F.objectNode();
        provenance.put("sourceRef", "fixture:employee");
        provenance.put("observedAt", NOW);
        provenance.put("version", "facts-v1");
        provenance.put("assurance", assurance);
        ObjectNode out = F.objectNode();
        out.put("status", value.isNull() ? "unknown" : "known");
        out.set("value", value);
        out.set("unit", unit);
        out.set("provenance", provenance);
        return out;
    }

    private static JsonNode seedRef(JsonNode spec, JsonNode seed) {
        JsonNode base = spec.has("path") && !spec.get("path").isNull() ? seed.get(spec.get("path").textValue()) : seed;
        ObjectNode copy = base.deepCopy();
        JsonNode set = spec.get("set");
        if (set != null) for (Iterator<Map.Entry<String, JsonNode>> it = set.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            copy.set(e.getKey(), e.getValue());
        }
        JsonNode removed = spec.get("delete");
        if (removed != null) for (JsonNode key : removed) copy.remove(key.textValue());
        return copy;
    }

    // ---- structural comparison ------------------------------------------------------------------------------

    private String diff(String name, String fn, String path, JsonNode expected, JsonNode actual) {
        JsonNode a = actual == null ? F.nullNode() : actual;
        if (expected == null) expected = F.nullNode();
        if (expected.isNumber() && a.isNumber()) return number(fn, path, expected.doubleValue(), a.doubleValue());
        if (expected.isObject() && a.isObject()) {
            TreeSet<String> names = new TreeSet<>();
            expected.fieldNames().forEachRemaining(names::add);
            a.fieldNames().forEachRemaining(names::add);
            for (String key : names) {
                if (!expected.has(key) || !a.has(key)) return path + "." + key + ": expected " + abbreviate(expected.get(key)) + " actual " + abbreviate(a.get(key));
                String d = diff(name, fn, path + "." + key, expected.get(key), a.get(key));
                if (d != null) return d;
            }
            return null;
        }
        if (expected.isArray() && a.isArray()) {
            if (expected.size() != a.size()) return path + ": array length " + expected.size() + " vs " + a.size();
            for (int i = 0; i < expected.size(); i++) {
                String d = diff(name, fn, path + "[" + i + "]", expected.get(i), a.get(i));
                if (d != null) return d;
            }
            return null;
        }
        return expected.equals(a) ? null : path + ": expected " + abbreviate(expected) + " actual " + abbreviate(a);
    }

    private String number(String fn, String path, double expected, double actual) {
        compared++;
        double d = Math.abs(expected - actual);
        if (Double.isNaN(d)) return path + ": " + expected + " vs " + actual;
        maxDiff = Math.max(maxDiff, d);
        boolean exact = fn.equals("rankEmployeeRecommendations") || expected == Math.rint(expected) || isExactPath(path);
        if (exact ? expected != actual : d > BOUND) return path + ": expected " + expected + " actual " + actual + (exact ? " (exact)" : "");
        return null;
    }

    private static boolean isExactPath(String path) {
        for (String segment : path.split("[.\\[\\]]+")) if (EXACT.contains(segment)) return true;
        return false;
    }

    private static String abbreviate(JsonNode n) {
        String s = n == null ? "undefined" : n.toString();
        return s.length() > 160 ? s.substring(0, 160) + "..." : s;
    }
}
