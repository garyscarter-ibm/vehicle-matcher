package gcsp.api.activity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Pure projections over one employee's stored allocation and clock rows, as the Node activity module computes them. */
final class ActivityChecks {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final List<String> STAGES = List.of("release-pull", "buddy-allocation");

    private ActivityChecks() {}

    /** Trimmed, control-free text of 1 to 512 characters: what the portal's parser accepts. */
    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && text(n.textValue());
    }

    static boolean text(String s) {
        return s != null && !s.isEmpty() && s.length() <= 512 && s.equals(s.strip()) && s.chars().noneMatch(ch -> ch < 0x20 || ch == 0x7f);
    }

    private static boolean scalar(JsonNode n) {
        return n != null && (text(n) || n.isBoolean() || n.isNumber() && Double.isFinite(n.doubleValue()));
    }

    private static ObjectNode required(JsonNode r) {
        ObjectNode out = F.objectNode();
        if (r == null || !r.isObject()) return out;
        for (String key : List.of("operator", "unit", "value")) {
            JsonNode v = r.get(key);
            if (scalar(v)) {
                out.set(key, v);
            } else if ("value".equals(key) && v != null && v.isArray() && v.size() <= 20) {
                boolean all = true;
                for (JsonNode item : v) all &= text(item);
                if (all) out.set(key, v);
            }
        }
        return out;
    }

    /** With no suitable car, the top two essentials this employee's own decisions failed on (most cars first). */
    static ArrayNode exclusions(JsonNode decisions) {
        Map<String, ObjectNode> found = new LinkedHashMap<>();
        for (JsonNode row : decisions) {
            Map<String, JsonNode> unmet = new LinkedHashMap<>();
            for (JsonNode b : row.path("blockers")) {
                if ("essential-unmet".equals(b.path("code").asText(null)) && text(b.get("field"))) unmet.putIfAbsent(b.get("field").textValue(), b);
            }
            unmet.forEach((field, b) -> {
                ObjectNode entry = found.computeIfAbsent(field,
                        k -> F.objectNode().put("essential", field).<ObjectNode>set("requirement", required(b.get("requirement"))).put("cars", 0));
                entry.put("cars", entry.get("cars").intValue() + 1);
            });
        }
        List<ObjectNode> sorted = new ArrayList<>(found.values());
        sorted.sort((a, b) -> b.get("cars").intValue() != a.get("cars").intValue()
                ? Integer.compare(b.get("cars").intValue(), a.get("cars").intValue())
                : a.get("essential").textValue().compareTo(b.get("essential").textValue()));
        ArrayNode out = F.arrayNode();
        sorted.stream().limit(2).forEach(out::add);
        return out;
    }

    /** One completed allocation as this employee's check; null when the stored decisions are not a list. */
    static ObjectNode check(String checkedAt, long clockVersion, boolean assigned, String excludedCode, JsonNode evaluation) {
        JsonNode decisions = evaluation.get("decisions");
        if (decisions == null || !decisions.isArray()) return null;
        int suitable = 0;
        boolean unknownRenewal = "renewal-deadline-unknown".equals(excludedCode);
        for (JsonNode d : decisions) {
            if ("eligible".equals(d.path("gateStatus").asText(null))) suitable++;
            for (JsonNode b : d.path("blockers")) unknownRenewal |= "renewal-deadline-unknown".equals(b.path("code").asText(null));
        }
        ObjectNode out = F.objectNode();
        out.put("checkedAt", checkedAt).put("clockVersion", Long.toString(clockVersion));
        out.put("carsChecked", decisions.size()).put("suitableCars", suitable);
        out.set("exclusions", suitable > 0 ? F.arrayNode() : exclusions(decisions));
        out.put("outcome", assigned ? "offer-held" : "no-match");
        if (unknownRenewal) out.put("limitation", "renewal-deadline-unknown");
        return out;
    }

    /** The latest tick's health for the stock-release and Buddy-allocation stages; tick is null when it is not stored. */
    static String sourceStatus(boolean hasTickId, String state, JsonNode order, JsonNode outcomes) {
        if (!hasTickId) return "not-checked";
        if (state == null || order == null || !order.isArray() || outcomes == null || !outcomes.isArray()) return "evidence-unavailable";
        List<JsonNode> results = new ArrayList<>();
        boolean failed = false, pending = false, missing = false;
        for (JsonNode entry : order) {
            if (!STAGES.contains(entry.path("stage").asText(null))) continue;
            JsonNode outcome = null;
            for (JsonNode row : outcomes) {
                if (row.path("handlerId").asText("").equals(entry.path("handlerId").asText(null))) {
                    outcome = row.get("outcome");
                    break;
                }
            }
            if (outcome == null || outcome.isNull()) {
                missing = true;
                continue;
            }
            results.add(outcome);
            String status = outcome.path("status").asText("");
            failed |= !status.equals("ok") && !status.equals("pending");
            pending |= status.equals("pending");
        }
        if ("interrupted".equals(state) || failed) return "unavailable";
        if (state.equals("pending") || state.equals("running") || pending) return "delayed";
        if (!state.equals("completed")) return "evidence-unavailable";
        return results.isEmpty() && !missing ? "not-checked" : missing ? "unavailable" : "ok";
    }
}
