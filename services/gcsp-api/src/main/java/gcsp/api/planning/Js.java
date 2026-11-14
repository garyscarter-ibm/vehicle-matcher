package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** The small JavaScript predicates of the Node planner, over Jackson nodes (null stands for undefined). */
final class Js {

    private Js() {
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    static boolean array(JsonNode n) {
        return n != null && n.isArray();
    }

    /** n.name for an object, else undefined (null). */
    static JsonNode get(JsonNode n, String name) {
        return object(n) ? n.get(name) : null;
    }

    /** Node's text(): a non-empty string of at most 512 UTF-16 units. */
    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && n.textValue().length() > 0 && n.textValue().length() <= 512;
    }

    static boolean integer(JsonNode n) {
        return JsNum.integer(n);
    }

    static List<JsonNode> items(JsonNode n) {
        List<JsonNode> out = new ArrayList<>();
        if (array(n)) {
            n.elements().forEachRemaining(out::add);
        }
        return out;
    }

    static boolean everyText(JsonNode array) {
        return items(array).stream().allMatch(Js::text);
    }

    /** new Set(values).size === values.length, with objects distinct by identity and numbers by value. */
    static boolean unique(List<JsonNode> values) {
        Set<Object> seen = new HashSet<>();
        for (JsonNode v : values) {
            Object key;
            if (v == null) {
                key = "u:";
            } else if (v.isTextual()) {
                key = "s:" + v.textValue();
            } else if (v.isNumber()) {
                key = "n:" + (v.doubleValue() == 0 ? 0.0 : v.doubleValue());
            } else if (v.isBoolean()) {
                key = "b:" + v.booleanValue();
            } else if (v.isNull()) {
                key = "null:";
            } else {
                key = new Object();
            }
            if (!seen.add(key)) {
                return false;
            }
        }
        return true;
    }

    /** True when every JSON number is a finite double and no key is __proto__, prototype or constructor. */
    static boolean jsonData(JsonNode n) {
        if (n == null || n.isNull() || n.isTextual() || n.isBoolean()) {
            return true;
        }
        if (n.isNumber()) {
            return !Double.isInfinite(n.doubleValue()) && !Double.isNaN(n.doubleValue());
        }
        if (n.isArray()) {
            for (JsonNode e : n) {
                if (!jsonData(e)) {
                    return false;
                }
            }
            return true;
        }
        if (n.isObject()) {
            Iterator<java.util.Map.Entry<String, JsonNode>> it = n.fields();
            while (it.hasNext()) {
                var e = it.next();
                String k = e.getKey();
                if (k.equals("__proto__") || k.equals("prototype") || k.equals("constructor") || !jsonData(e.getValue())) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /** String(value) for the values a JSON currency could hold, as the regex test coerces it. */
    static String coerce(JsonNode n) {
        if (n == null || n.isNull()) {
            return "";
        }
        if (n.isTextual()) {
            return n.textValue();
        }
        if (n.isNumber()) {
            return JsNum.str(n.doubleValue());
        }
        if (n.isBoolean()) {
            return String.valueOf(n.booleanValue());
        }
        if (n.isArray()) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < n.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                JsonNode e = n.get(i);
                sb.append(e.isNull() ? "" : coerce(e));
            }
            return sb.toString();
        }
        return "[object Object]";
    }
}
