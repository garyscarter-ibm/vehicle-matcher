package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Replays evaluation-cases.json (recommendation-evaluation-parity.mjs) through the Java service; never runs Node. */
class EvaluationParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final double BOUND = 1e-9;
    private static final int FLOOR = 600;
    /** Values that are displayed, decide an outcome or echo an input must match exactly, not within the bound. */
    private static final Set<String> EXACT = Set.of("score", "observed", "desired", "facts", "fact", "requirement", "preference",
            "value", "importance", "unit", "monthlyPoints", "allowance", "points", "eligibleCount", "termValiditySeconds");

    @TempDir
    Path dir;

    private double maxDiff;
    private long compared;
    private long digests;
    private int statusMismatches;
    private int nonFaultThrows;

    @Test
    void javaMatchesTheNodeEvaluation() throws IOException {
        JsonNode seed = MAPPER.readTree(Files.readAllBytes(Path.of("../../server/gcsp/policy/seed-v1.json")));
        JsonNode variants;
        JsonNode file;
        try (InputStream in = getClass().getResourceAsStream("/recommendation-parity/evaluation-variants.json")) {
            variants = MAPPER.readTree(in);
        }
        try (InputStream in = getClass().getResourceAsStream("/recommendation-parity/evaluation-cases.json")) {
            file = MAPPER.readTree(in);
        }
        JsonNode pool = file.get("pool");
        JsonNode cases = file.get("cases");
        assertTrue(cases.size() > FLOOR, "case count " + cases.size() + " is above " + FLOOR);
        Map<String, PolicyService> services = new HashMap<>();
        List<String> failures = new ArrayList<>();
        for (JsonNode c : cases) {
            String name = c.get("name").textValue();
            try {
                JsonNode expected = expand(c.get("expected"), pool);
                JsonNode actual = run(c, pool, seed, variants, services);
                String diff = diff("$", expected, actual, actual);
                if (!status(expected).equals(status(actual))) statusMismatches++;
                if (diff != null) failures.add(name + " -> " + diff);
            } catch (RuntimeException e) {
                if (!(e instanceof RecommendationFault)) nonFaultThrows++;
                failures.add(name + " -> Java threw " + e);
            }
        }
        System.out.printf("Evaluation parity: %d cases, %d numbers compared, max absolute numeric difference %s, "
                + "%d assumption digests matched, %d outcome status mismatches, %d throws escaped the service%n",
                cases.size(), compared, maxDiff, digests, statusMismatches, nonFaultThrows);
        if (!failures.isEmpty()) {
            fail(failures.size() + " parity failures; first:\n" + String.join("\n", failures.subList(0, Math.min(12, failures.size()))));
        }
        assertEquals(0, statusMismatches, "outcome status mismatches");
        assertTrue(maxDiff <= BOUND, "numeric difference " + maxDiff);
    }

    private static String status(JsonNode outcome) {
        return outcome != null && outcome.has("status") ? outcome.get("status").asText() : "?";
    }

    // ---- running a case -------------------------------------------------------------------------------------

    private JsonNode run(JsonNode c, JsonNode pool, JsonNode seed, JsonNode variants, Map<String, PolicyService> services) throws IOException {
        Set<String> missing = new TreeSet<>();
        if (c.has("missing")) c.get("missing").forEach(m -> missing.add(m.textValue()));
        PolicyService policy = missing.contains("policy") ? null : policy(c.get("variant").textValue(), seed, variants, services);
        if (policy != null && c.has("wrap")) policy = new Skewed(policy, c.get("wrap").textValue());
        RecommendationSource source = missing.contains("provider") ? null : source(expand(c.get("source"), pool));
        RecommendationClock clock = missing.contains("clock") ? null : clock(c.get("clock"));
        String op = c.get("op").textValue();
        if (op.equals("stored")) {
            return new StoredSubjectEvaluator(source, policy, clock).evaluate(expand(c.get("subject"), pool), expand(c.get("brief"), pool));
        }
        RecommendationService service = new RecommendationService(source, policy, clock);
        RecommendationContext context = context(c.get("context"));
        return op.equals("preview") ? service.previewUnsaved(context, expand(c.get("input"), pool))
                : service.recommend(context, expand(c.get("request"), pool));
    }

    private static RecommendationContext context(JsonNode n) {
        if (n == null || n.isNull()) return null;
        List<String> roles = new ArrayList<>();
        if (n.has("roles")) n.get("roles").forEach(r -> roles.add(r.textValue()));
        return new RecommendationContext(text(n, "runId"), text(n, "environmentId"), text(n, "employeeId"), text(n, "companyId"),
                text(n, "schemeId"), text(n, "gradeId"), text(n, "policyVersion"), roles);
    }

    private static String text(JsonNode n, String key) {
        JsonNode v = n.get(key);
        return v == null || v.isNull() ? null : v.textValue();
    }

    private static RecommendationSource source(JsonNode spec) {
        if (spec == null) return null;
        return switch (spec.get("kind").textValue()) {
            case "throw" -> context -> {
                throw new IllegalStateException("offline");
            };
            case "undefined" -> context -> null;
            case "raw" -> context -> spec.get("outcome").deepCopy();
            default -> context -> new Js.B().s("status", "ok").s("value", spec.get("value").deepCopy()).build();
        };
    }

    private static RecommendationClock clock(JsonNode spec) {
        if (spec == null) return null;
        return switch (spec.get("kind").textValue()) {
            case "throw" -> context -> {
                throw new IllegalStateException("clock");
            };
            case "undefined" -> context -> null;
            case "raw" -> context -> spec.get("outcome").deepCopy();
            default -> context -> new Js.B().s("status", "ok").s("value", new Js.B().s("now", spec.get("now"))
                    .s("runId", spec.get("runId")).s("clockVersion", spec.get("clockVersion")).build()).build();
        };
    }

    /** The Node wrapper that reports another policy version from the named reads. */
    private static final class Skewed extends PolicyService {
        private static final Map<String, List<String>> MODES = Map.of("skew-all", List.of("allowance", "assumption", "eligibility", "points"),
                "skew-eligibility", List.of("eligibility"), "skew-points", List.of("points"), "skew-assumption", List.of("assumption"),
                "skew-allowance", List.of("allowance"));
        private final PolicyService inner;
        private final List<String> skewed;

        Skewed(PolicyService inner, String mode) {
            super(null);
            this.inner = inner;
            this.skewed = MODES.get(mode);
        }

        private PolicyResult skew(String what, PolicyResult r) {
            return skewed.contains(what) ? new PolicyResult(r.status(), "another-policy", r.body()) : r;
        }

        @Override
        public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
            return skew("allowance", inner.getAllowance(context, read));
        }

        @Override
        public PolicyResult getAssumption(String key, PolicyRead read) {
            return skew("assumption", inner.getAssumption(key, read));
        }

        @Override
        public PolicyResult getEligibility(PolicyContext context, JsonNode car, PolicyRead read) {
            return skew("eligibility", inner.getEligibility(context, car, read));
        }

        @Override
        public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
            return skew("points", inner.getPointsCost(context, car, read));
        }
    }

    // ---- seed variants (interpreted like the generator) -----------------------------------------------------

    private static final List<String> TABLES = List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions");

    private PolicyService policy(String name, JsonNode seed, JsonNode variants, Map<String, PolicyService> services) throws IOException {
        PolicyService cached = services.get(name);
        if (cached != null) return cached;
        List<Path> paths = new ArrayList<>();
        int index = 0;
        for (JsonNode ops : variants.get(name)) {
            Path path = dir.resolve(name.replace('/', '_') + "-" + index++ + ".json");
            if (ops.size() == 1 && ops.get(0).has("raw")) Files.writeString(path, ops.get(0).get("raw").textValue());
            else if (!(ops.size() == 1 && ops.get(0).has("missing"))) Files.writeString(path, apply(seed.deepCopy(), ops).toString());
            paths.add(path);
        }
        PolicyService created = new PolicyService(new RetainedFilePolicySource(paths.get(0), paths.subList(1, paths.size())));
        services.put(name, created);
        return created;
    }

    private static boolean matching(JsonNode row, JsonNode where) {
        for (Iterator<Map.Entry<String, JsonNode>> it = where.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!e.getValue().equals(row.get(e.getKey()))) return false;
        }
        return true;
    }

    private static JsonNode apply(ObjectNode value, JsonNode ops) {
        for (JsonNode op : ops) {
            switch (op.get("op").textValue()) {
                case "revise" -> {
                    value.set("policyVersion", op.get("policyVersion"));
                    value.set("effectiveFrom", op.get("effectiveFrom"));
                    for (String table : TABLES) for (JsonNode row : value.get(table)) ((ObjectNode) row).set("policyVersion", op.get("policyVersion"));
                }
                case "set" -> setPath(value, op.get("path").textValue(), op.get("value"), false);
                case "assumption" -> {
                    for (JsonNode row : value.get("assumptions")) {
                        if (!row.get("key").equals(op.get("key"))) continue;
                        if (op.get("path").textValue().isEmpty()) ((ObjectNode) row).set("value", op.get("value"));
                        else setPath((ObjectNode) row.get("value"), op.get("path").textValue(), op.get("value"), !op.has("value"));
                    }
                }
                case "dropAssumption" -> {
                    ArrayNode kept = F.arrayNode();
                    for (JsonNode row : value.get("assumptions")) if (!row.get("key").equals(op.get("key"))) kept.add(row);
                    value.set("assumptions", kept);
                }
                case "rows" -> {
                    for (JsonNode row : value.get(op.get("table").textValue())) {
                        if (matching(row, op.get("where"))) ((ObjectNode) row).setAll((ObjectNode) op.get("set"));
                    }
                }
                case "dropRows" -> {
                    ArrayNode kept = F.arrayNode();
                    for (JsonNode row : value.get(op.get("table").textValue())) if (!matching(row, op.get("where"))) kept.add(row);
                    value.set(op.get("table").textValue(), kept);
                }
                case "addRow" -> {
                    ArrayNode table = (ArrayNode) value.get(op.get("table").textValue());
                    ObjectNode row = null;
                    for (JsonNode candidate : table) {
                        if (matching(candidate, op.get("from"))) {
                            row = candidate.deepCopy();
                            break;
                        }
                    }
                    row.setAll((ObjectNode) op.get("set"));
                    if (op.has("delete")) for (JsonNode key : op.get("delete")) row.remove(key.textValue());
                    table.add(row);
                }
                default -> throw new IllegalStateException(op.toString());
            }
        }
        return value;
    }

    private static void setPath(ObjectNode target, String path, JsonNode value, boolean remove) {
        String[] parts = path.split("\\.");
        JsonNode holder = target;
        for (int i = 0; i < parts.length - 1; i++) holder = holder.get(parts[i]);
        if (remove) ((ObjectNode) holder).remove(parts[parts.length - 1]);
        else ((ObjectNode) holder).set(parts[parts.length - 1], value);
    }

    // ---- fixture expansion ----------------------------------------------------------------------------------

    private static JsonNode expand(JsonNode n, JsonNode pool) {
        if (n == null) return null;
        if (n.isArray()) {
            ArrayNode out = F.arrayNode();
            for (JsonNode e : n) out.add(expand(e, pool));
            return out;
        }
        if (!n.isObject()) return n;
        if (n.size() == 1 && n.has("$pool")) return expand(pool.get(n.get("$pool").intValue()), pool);
        ObjectNode out = F.objectNode();
        for (Iterator<Map.Entry<String, JsonNode>> it = n.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            out.set(e.getKey(), expand(e.getValue(), pool));
        }
        return out;
    }

    // ---- structural comparison ------------------------------------------------------------------------------

    private String diff(String path, JsonNode expected, JsonNode actual, JsonNode root) {
        JsonNode a = actual == null ? F.nullNode() : actual;
        if (expected == null) expected = F.nullNode();
        if (expected.isObject() && expected.size() == 1 && expected.has("$sha256")) {
            String hex = sha256(canonical(a));
            digests++;
            return hex.equals(expected.get("$sha256").textValue()) ? null : path + ": assumption digest differs";
        }
        if (expected.isNumber() && a.isNumber()) return number(path, expected.doubleValue(), a.doubleValue());
        if (expected.isObject() && a.isObject()) {
            TreeSet<String> names = new TreeSet<>();
            expected.fieldNames().forEachRemaining(names::add);
            a.fieldNames().forEachRemaining(names::add);
            for (String key : names) {
                if (!expected.has(key) || !a.has(key)) return path + "." + key + ": expected " + abbreviate(expected.get(key)) + " actual " + abbreviate(a.get(key));
                String d = diff(path + "." + key, expected.get(key), a.get(key), root);
                if (d != null) return d;
            }
            return null;
        }
        if (expected.isArray() && a.isArray()) {
            if (expected.size() != a.size()) return path + ": array length " + expected.size() + " vs " + a.size();
            for (int i = 0; i < expected.size(); i++) {
                String d = diff(path + "[" + i + "]", expected.get(i), a.get(i), root);
                if (d != null) return d;
            }
            return null;
        }
        return expected.equals(a) ? null : path + ": expected " + abbreviate(expected) + " actual " + abbreviate(a);
    }

    private String number(String path, double expected, double actual) {
        compared++;
        double d = Math.abs(expected - actual);
        if (Double.isNaN(d)) return path + ": " + expected + " vs " + actual;
        maxDiff = Math.max(maxDiff, d);
        boolean exact = expected == Math.rint(expected) || isExactPath(path);
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

    // ---- canonical JSON digest (sorted keys, JSON.stringify number formatting) ------------------------------

    private static String sha256(String s) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : hash) out.append(String.format("%02x", b & 0xff));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String canonical(JsonNode n) {
        if (n.isArray()) {
            StringBuilder out = new StringBuilder("[");
            for (int i = 0; i < n.size(); i++) out.append(i > 0 ? "," : "").append(canonical(n.get(i)));
            return out.append("]").toString();
        }
        if (n.isObject()) {
            TreeSet<String> names = new TreeSet<>();
            n.fieldNames().forEachRemaining(names::add);
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (String key : names) {
                out.append(first ? "" : ",").append(quote(key)).append(":").append(canonical(n.get(key)));
                first = false;
            }
            return out.append("}").toString();
        }
        if (n.isTextual()) return quote(n.textValue());
        if (n.isNumber()) return jsNumber(n.doubleValue());
        return n.toString();
    }

    private static String quote(String s) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> out.append(c < 0x20 ? String.format("\\u%04x", (int) c) : String.valueOf(c));
            }
        }
        return out.append('"').toString();
    }

    /** Number.prototype.toString for finite doubles. */
    static String jsNumber(double d) {
        if (d == 0) return "0";
        double abs = Math.abs(d);
        String sign = d < 0 ? "-" : "";
        if (d == Math.rint(d) && abs < 1e21) return sign + new BigDecimal(abs).toBigInteger();
        BigDecimal bd = new BigDecimal(Double.toString(abs)).stripTrailingZeros();
        if (abs >= 1e-6 && abs < 1e21) return sign + bd.toPlainString();
        String digits = bd.unscaledValue().toString();
        int exponent = digits.length() - 1 - bd.scale();
        String mantissa = digits.length() > 1 ? digits.charAt(0) + "." + digits.substring(1) : digits;
        return sign + mantissa + "e" + (exponent >= 0 ? "+" : "-") + Math.abs(exponent);
    }
}
