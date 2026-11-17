package gcsp.api.cases;

import static gcsp.api.cases.CaseJson.integer;
import static gcsp.api.cases.CaseJson.object;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** The renewalCase.* rules parsed from exactly the pinned policy version; any malformed row makes it unavailable. */
record CasePolicy(String policyVersion, String ownerRole, int dueHours, boolean extensionPermitted, ArrayNode assumptions,
        boolean deadlineEnabled, int withinDays, boolean lifecycleEnabled, List<String> lifecycleEventTypes,
        List<String> selectionEventTypes, Map<String, Copy> exceptionCopy) {

    /** The configured label and reason that name one lifecycle exception. */
    record Copy(String label, String reason) {}

    static final List<String> KEYS = List.of("renewalCase.deadline.enabled", "renewalCase.deadline.withinDays",
            "renewalCase.lifecycle.enabled", "renewalCase.lifecycle.eventTypes", "renewalCase.selection.eventTypes",
            "renewalCase.owner.role", "renewalCase.response.dueHours", "renewalCase.extension.permitted",
            "renewalCase.lifecycle.exceptionCopy");

    /** Empty when the policy is unavailable or any of the nine rows fails the Node checks. */
    static Optional<CasePolicy> load(CasePolicyPort port, String policyVersion) {
        Optional<Map<String, JsonNode>> found = port.assumptions(policyVersion);
        if (found.isEmpty()) return Optional.empty();
        JsonNode[] values = new JsonNode[KEYS.size()];
        ArrayNode shown = CaseJson.arr();
        for (int i = 0; i < KEYS.size(); i++) {
            JsonNode row = found.get().get(KEYS.get(i));
            if (!object(row) || !policyVersion.equals(row.path("policyVersion").asText(null))
                    || !CaseJson.text(row.get("basis"), Integer.MAX_VALUE) || !CaseJson.text(row.get("unit"), Integer.MAX_VALUE)
                    || !List.of("assumed", "verified").contains(row.path("status").asText(""))) return Optional.empty();
            values[i] = row.get("value");
            shown.add(row.deepCopy());
        }
        JsonNode copy = values[8];
        boolean booleans = values[0] != null && values[0].isBoolean() && values[2] != null && values[2].isBoolean()
                && values[7] != null && values[7].isBoolean();
        if (!booleans || !integer(values[1]) || values[1].doubleValue() < 0 || !list(values[3]) || !list(values[4])
                || values[5] == null || !"scheme-team".equals(values[5].asText(null)) || !integer(values[6])
                || values[6].doubleValue() < 1 || !object(copy)) return Optional.empty();
        Map<String, Copy> copies = new LinkedHashMap<>();
        for (var it = copy.fields(); it.hasNext();) {
            var c = it.next();
            JsonNode v = c.getValue();
            if (!object(v) || !CaseJson.text(v.get("label"), 120) || !CaseJson.text(v.get("reason"), 500)) return Optional.empty();
            copies.put(c.getKey(), new Copy(v.get("label").textValue(), v.get("reason").textValue()));
        }
        return Optional.of(new CasePolicy(policyVersion, values[5].textValue(), values[6].intValue(),
                values[7].booleanValue(), shown, values[0].booleanValue(), values[1].intValue(), values[2].booleanValue(),
                strings(values[3]), strings(values[4]), copies));
    }

    private static List<String> strings(JsonNode v) {
        List<String> out = new ArrayList<>();
        v.forEach(n -> out.add(n.textValue()));
        return out;
    }

    private static boolean list(JsonNode v) {
        if (v == null || !v.isArray() || v.isEmpty()) return false;
        Set<String> seen = new HashSet<>();
        for (JsonNode n : v) {
            if (!n.isTextual() || n.textValue().isEmpty() || n.textValue().length() > 128 || !seen.add(n.textValue())) return false;
        }
        return true;
    }
}
