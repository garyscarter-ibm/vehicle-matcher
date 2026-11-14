package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;

/** JavaScript value semantics the Node baseline relies on; a Java null stands for JS undefined. */
final class Js {

    private Js() {}

    /** Node `value?.key`: undefined unless value is an object holding the key. */
    static JsonNode field(JsonNode node, String key) {
        return node != null && node.isObject() ? node.get(key) : null;
    }

    static boolean isObject(JsonNode node) {
        return node != null && node.isObject();
    }

    static boolean truthy(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) return false;
        if (node.isTextual()) return !node.textValue().isEmpty();
        if (node.isBoolean()) return node.booleanValue();
        if (node.isNumber()) return node.doubleValue() != 0 && !Double.isNaN(node.doubleValue());
        return true;
    }

    /** Node `a || b`. */
    static JsonNode or(JsonNode a, JsonNode b) {
        return truthy(a) ? a : b;
    }

    static boolean is(JsonNode node, String text) {
        return node != null && node.isTextual() && node.textValue().equals(text);
    }

    /** Node structuredClone with undefined mapped to null. */
    static JsonNode copy(JsonNode node) {
        return node == null ? NullNode.instance : node.deepCopy();
    }

    /** Node `===` over JSON scalars; distinct containers are never equal. */
    static boolean strictEquals(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isContainerNode() || b.isContainerNode()) return false;
        if (a.isNumber() && b.isNumber()) return a.doubleValue() == b.doubleValue();
        return a.equals(b);
    }

    /** Node text(): a string of 1 to 4096 characters. */
    static boolean text(String value) {
        return value != null && !value.isEmpty() && value.length() <= 4096;
    }

    /** Node text() over a JSON member. */
    static boolean text(JsonNode node) {
        return node != null && node.isTextual() && text(node.textValue());
    }

    /** JavaScript string coercion of a JSON value, as new URL(value) applies it; MissingNode is undefined. */
    static String coerce(JsonNode node) {
        if (node == null || node.isMissingNode()) return "undefined";
        if (node.isNull()) return "null";
        if (node.isTextual()) return node.textValue();
        if (node.isArray()) {
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < node.size(); i++) {
                if (i > 0) out.append(',');
                JsonNode item = node.get(i);
                if (!item.isNull()) out.append(coerce(item));
            }
            return out.toString();
        }
        if (node.isObject()) return "[object Object]";
        return node.isIntegralNumber() ? node.asText() : CanonicalJson.numberToString(node.doubleValue());
    }
}
