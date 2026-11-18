package gcsp.api.brief;

import static gcsp.api.brief.Json.integer;
import static gcsp.api.brief.Json.object;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The one confirmed change of a decline follow-up: Node's applyConfirmedFeedbackChange (confirm-change on a preference
 * value or an essential) and BriefService#addTarget, which may add one adopted follow-up target the brief lacks.
 */
final class FeedbackChange {

    /** The route's path rule; the feedback action then applies the stricter key rule below. */
    static final Pattern ROUTE_PATH = Pattern.compile("^preferences\\.[^.]+\\.value$|^essentials\\.[^.]+$");
    private static final Pattern ACTION_PATH =
            Pattern.compile("^preferences\\.[a-zA-Z][a-zA-Z0-9]*\\.(value|importance)$|^essentials\\.[a-zA-Z][a-zA-Z0-9]*$");

    /** code is null on success; otherwise one of invalid-target, unknown-field, confirmed-essential-required, unchanged-value, invalid-value. */
    record Applied(String code, ObjectNode brief, JsonNode before, JsonNode after) {
        boolean ok() {
            return code == null;
        }

        static Applied fail(String code) {
            return new Applied(code, null, null, null);
        }
    }

    private FeedbackChange() {}

    static Applied apply(ObjectNode brief, String path, JsonNode value, String now) {
        if (!ACTION_PATH.matcher(path).matches()) return Applied.fail("invalid-target");
        String[] parts = path.split("\\.", -1);
        String section = parts[0];
        String key = parts[1];
        String field = parts.length > 2 ? parts[2] : null;
        JsonNode sectionNode = brief.get(section);
        if (!object(sectionNode) || !sectionNode.has(key)) return Applied.fail("unknown-field");
        JsonNode current = sectionNode.get(key);
        JsonNode before = (field == null ? current : current.get(field)).deepCopy();
        boolean essential = "essentials".equals(section);
        if (essential && (!object(value) || !"confirmed".equals(value.path("state").asText(null))
                || value.get("value") == null || value.get("value").isNull())) return Applied.fail("confirmed-essential-required");
        JsonNode after = essential ? withSource((ObjectNode) value.deepCopy(), now) : value.deepCopy();
        boolean same = essential ? same(meaning(before), meaning(after)) : same(unwrap(before), unwrap(after));
        if (same) return Applied.fail("unchanged-value");
        ObjectNode next = brief.deepCopy();
        if (essential) {
            ((ObjectNode) next.get("essentials")).set(key, after);
        } else {
            ObjectNode p = (ObjectNode) next.get("preferences").get(key);
            p.set(field, after);
            p.put("source", "employee").put("valueState", "confirmed").put("confirmedAt", now);
        }
        return new Applied(null, next, before, after);
    }

    /**
     * Adds a registered follow-up target the brief lacks, within the adopted question's control. Null when the path is not
     * such a target (the shared change then applies). questions is the adopted question payload or null.
     */
    static Applied addTarget(ObjectNode brief, String path, JsonNode value, PolicyRules rules, JsonNode questions, String now) {
        String[] parts = path.split("\\.", -1);
        String section = parts[0];
        String key = parts[1];
        JsonNode registered = rules.config.get(section);
        if (!object(brief.get(section)) || brief.get(section).has(key) || !object(registered) || !registered.has(key)) return null;
        if (questions == null || !questions.path("questions").isArray()) return null;
        JsonNode question = null;
        for (JsonNode q : questions.get("questions")) {
            if (q != null && path.equals(q.path("path").asText(null))) {
                question = q;
                break;
            }
        }
        JsonNode control = question == null ? null : question.get("control");
        if (!object(control)) return null;
        ObjectNode next = brief.deepCopy();
        if ("preferences".equals(section)) {
            boolean options = "options".equals(control.path("kind").asText());
            boolean allowed = options ? control.path("options").isArray() && hasOption(control.get("options"), value)
                    : "slider".equals(control.path("kind").asText()) && integer(value) && value.doubleValue() >= rules.minimum
                            && value.doubleValue() <= rules.maximum;
            if (!allowed) return Applied.fail("invalid-value");
            JsonNode importance = rules.editor.path("preferences").path(key).get("importance");
            if (!integer(importance) || importance.intValue() < rules.minimum || importance.intValue() > rules.maximum) {
                throw new BriefResult.Refused(BriefResult.Refusal.unavailable());
            }
            ObjectNode p = ((ObjectNode) next.get("preferences")).putObject(key);
            p.set("value", value.deepCopy());
            p.set("importance", importance.deepCopy());
            p.put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee").put("confirmedAt", now);
            return new Applied(null, next, null, value.deepCopy());
        }
        if (!object(value) || !"confirmed".equals(value.path("state").asText(null)) || value.get("value") == null
                || value.get("value").isNull()) return Applied.fail("confirmed-essential-required");
        if (!"equipment".equals(control.path("kind").asText()) || !"includes".equals(value.path("operator").asText(null))
                || !"equipment-key".equals(value.path("unit").asText(null)) || !equipmentValid(value.get("value"), control)) {
            return Applied.fail("invalid-value");
        }
        ObjectNode after = withSource((ObjectNode) value.deepCopy(), now);
        ((ObjectNode) next.get("essentials")).set(key, after);
        return new Applied(null, next, null, after);
    }

    private static boolean hasOption(JsonNode options, JsonNode value) {
        for (JsonNode o : options) if (o != null && o.has("value") && o.get("value").equals(value)) return true;
        return false;
    }

    /** One equipment-list rule: unique, trimmed, non-blank items within the control's limits. */
    static boolean equipmentValid(JsonNode list, JsonNode control) {
        if (list == null || !list.isArray() || list.isEmpty() || !integer(control.get("maximumItems"))
                || !integer(control.get("maximumItemLength")) || list.size() > control.get("maximumItems").intValue()) return false;
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (JsonNode item : list) {
            if (!item.isTextual() || item.asText().isBlank() || !item.asText().equals(item.asText().trim())
                    || item.asText().length() > control.get("maximumItemLength").intValue() || !seen.add(item.asText())) return false;
        }
        return true;
    }

    private static ObjectNode withSource(ObjectNode essential, String now) {
        essential.put("source", "employee").put("confirmedAt", now);
        return essential;
    }

    /** A scalar x and the list [x] are one preference choice. */
    private static JsonNode unwrap(JsonNode v) {
        return v.isArray() && v.size() == 1 && v.get(0).isTextual() ? v.get(0) : v;
    }

    /** What an essential means: operator, value (a set for includes), unit and state; sources and times never count. */
    private static JsonNode meaning(JsonNode e) {
        ObjectNode m = Json.obj();
        if (e.has("operator")) m.set("operator", e.get("operator"));
        JsonNode v = e.get("value");
        if (v != null) {
            if ("includes".equals(e.path("operator").asText(null)) && v.isArray()) {
                List<JsonNode> unique = new ArrayList<>(new LinkedHashSet<>(toList(v)));
                unique.sort((a, b) -> a.asText().compareTo(b.asText()));
                ArrayNode sorted = Json.arr();
                unique.forEach(sorted::add);
                m.set("value", sorted);
            } else {
                m.set("value", v);
            }
        }
        if (e.has("unit")) m.set("unit", e.get("unit"));
        if (e.has("state")) m.set("state", e.get("state"));
        return m;
    }

    private static List<JsonNode> toList(JsonNode array) {
        List<JsonNode> out = new ArrayList<>();
        array.forEach(out::add);
        return out;
    }

    /** JSON equality where 50 and 50.0 are one number. */
    static boolean same(JsonNode a, JsonNode b) {
        if (a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
        if (a.isArray() && b.isArray()) {
            if (a.size() != b.size()) return false;
            for (int i = 0; i < a.size(); i++) if (!same(a.get(i), b.get(i))) return false;
            return true;
        }
        if (a.isObject() && b.isObject()) {
            if (a.size() != b.size()) return false;
            for (var it = a.fields(); it.hasNext();) {
                var e = it.next();
                if (!b.has(e.getKey()) || !same(e.getValue(), b.get(e.getKey()))) return false;
            }
            return true;
        }
        return a.equals(b);
    }

    static boolean routePath(JsonNode path) {
        return path != null && path.isTextual() && !path.asText().isBlank() && ROUTE_PATH.matcher(path.asText()).matches();
    }
}
