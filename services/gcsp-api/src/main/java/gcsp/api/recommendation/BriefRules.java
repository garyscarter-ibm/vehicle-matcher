package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;

/** Brief request validation, ported from server/scenarios/employee/index.js; errors are {field, reason} objects. */
public final class BriefRules {

    private static final List<String> STATES = List.of("draft", "inferred", "confirmed");
    private static final List<String> ESSENTIAL_STATES = List.of("draft", "inferred", "confirmed", "needs-confirmation");

    private BriefRules() {}

    private static ArrayNode one(String field, String reason) {
        ArrayNode errors = Js.arr();
        errors.add(new Js.B().s("field", field).s("reason", reason).build());
        return errors;
    }

    public static ArrayNode validateBrief(JsonNode request, RecommendationConfig config, Slider slider) {
        if (!Js.only(request, List.of("schemaVersion", "briefVersion", "preferences", "essentials", "requiredBy"))
                || !Js.safeInt(request.get("briefVersion")) || request.get("briefVersion").doubleValue() <= 0) {
            return one("brief", "Supply the supported read-only brief contract.");
        }
        ObjectNode content = Js.obj();
        request.fields().forEachRemaining(e -> {
            if (!e.getKey().equals("briefVersion")) content.set(e.getKey(), e.getValue());
        });
        return validateBriefContent(content, config, slider);
    }

    /** A multiple enum takes a legacy scalar or unique registered values in registry order (stable digests). */
    public static boolean validChoice(JsonNode value, JsonNode definition) {
        JsonNode values = Js.get(definition, "values");
        if (values == null || !values.isArray()) return false;
        if (Js.eqBool(Js.get(definition, "multiple"), true) && value != null && value.isArray()) {
            if (value.size() == 0) return false;
            for (int i = 0; i < value.size(); i++) {
                JsonNode v = value.get(i);
                if (!Js.includes(values, v)) return false;
                if (i > 0 && !(indexOf(values, v) > indexOf(values, value.get(i - 1)))) return false;
            }
            return true;
        }
        return Js.includes(values, value);
    }

    private static int indexOf(JsonNode array, JsonNode value) {
        for (int i = 0; i < array.size(); i++) if (Js.strictEq(array.get(i), value)) return i;
        return -1;
    }

    /** Compatible read: a scalar x reads as [x] for a multiple enum (an absent value reads as [null]). */
    public static ArrayNode choiceList(JsonNode value) {
        if (value != null && value.isArray()) return (ArrayNode) value;
        ArrayNode list = Js.arr();
        list.add(value == null ? Js.F.nullNode() : value);
        return list;
    }

    /** Intent comparison: a scalar x and [x] are the same choice. */
    public static JsonNode intentValue(JsonNode value) {
        return value != null && value.isArray() && value.size() == 1 ? value.get(0) : value;
    }

    public static ArrayNode validateBriefContent(JsonNode request, RecommendationConfig config, Slider slider) {
        ArrayNode errors = Js.arr();
        if (!Js.only(request, List.of("schemaVersion", "preferences", "essentials", "requiredBy"))
                || !Js.strictEq(request.get("schemaVersion"), Js.F.numberNode(1))) {
            return one("brief", "Supply the supported brief content contract.");
        }
        JsonNode preferences = request.get("preferences");
        JsonNode essentials = request.get("essentials");
        if (!Js.object(preferences) || !Js.object(essentials)) return one("brief", "Supply preferences and essentials maps.");
        for (Map.Entry<String, JsonNode> entry : Js.entries(preferences)) {
            String key = entry.getKey();
            JsonNode p = entry.getValue();
            JsonNode all = config.read("preferences");
            JsonNode definition = Js.hasOwn(all, key) ? all.get(key) : null;
            if (invalidPreference(p, definition, slider)) add(errors, "preferences." + key);
        }
        for (Map.Entry<String, JsonNode> entry : Js.entries(essentials)) {
            String key = entry.getKey();
            JsonNode all = config.read("essentials");
            JsonNode d = Js.hasOwn(all, key) ? all.get(key) : null;
            if (invalidEssential(key, entry.getValue(), d, slider)) add(errors, "essentials." + key);
        }
        JsonNode requiredBy = request.get("requiredBy");
        if (requiredBy != null && !Js.validInstant(requiredBy)) add(errors, "requiredBy");
        return errors;
    }

    private static void add(ArrayNode errors, String field) {
        errors.add(new Js.B().s("field", field).s("reason", "Unsupported or invalid brief field.").build());
    }

    private static boolean within(JsonNode v, Slider s) {
        return Js.isInteger(v) && v.doubleValue() >= s.minimum() && v.doubleValue() <= s.maximum();
    }

    private static boolean invalidPreference(JsonNode p, JsonNode definition, Slider slider) {
        if (!Js.truthy(definition)
                || !Js.only(p, List.of("value", "importance", "valueState", "importanceState", "source", "confirmedAt"))
                || !within(p.get("importance"), slider) || !Js.includes(STATES, p.get("valueState"))
                || !Js.includes(STATES, p.get("importanceState")) || !Js.text(p.get("source"))
                || (p.get("confirmedAt") != null && !Js.validInstant(p.get("confirmedAt")))) {
            return true;
        }
        return Js.eqStr(Js.get(definition, "type"), "slider") ? !within(p.get("value"), slider) : !validChoice(p.get("value"), definition);
    }

    private static boolean invalidEssential(String key, JsonNode e, JsonNode d, Slider slider) {
        if (!Js.truthy(d)
                || !Js.only(e, List.of("value", "operator", "unit", "state", "source", "confirmedAt"))
                || !Js.strictEq(e.get("operator"), Js.get(d, "operator")) || !Js.strictEq(e.get("unit"), Js.get(d, "unit"))
                || !Js.includes(ESSENTIAL_STATES, e.get("state")) || !Js.text(e.get("source"))
                || (e.get("confirmedAt") != null && !Js.validInstant(e.get("confirmedAt")))) {
            return true;
        }
        JsonNode value = e.get("value");
        if (value != null && value.isNull()) return !Js.eqStr(e.get("state"), "needs-confirmation");
        JsonNode type = Js.get(d, "type");
        if (Js.eqStr(type, "number")
                && (!Js.finite(value) || value.doubleValue() < 0 || key.equals("seats") && !Js.isInteger(value))) return true;
        if (Js.eqStr(type, "enum") && !Js.includes(Js.get(d, "values"), value)) return true;
        if (Js.eqStr(type, "boolean") && !Js.isBool(value)) return true;
        if (Js.eqStr(type, "string") && !Js.text(value)) return true;
        if (Js.eqStr(type, "list")) {
            if (value == null || !value.isArray()) return true;
            for (JsonNode item : value) if (!Js.text(item)) return true;
        }
        return false;
    }
}
