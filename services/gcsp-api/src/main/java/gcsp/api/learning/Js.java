package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;

/** JavaScript value semantics the Node baseline relies on; a Java null stands for JS undefined. */
final class Js {

    private static final double MAX_SAFE = 9007199254740991.0;

    private Js() {}

    /** Node `value?.key`: undefined unless value is an object holding the key. */
    static JsonNode get(JsonNode node, String key) {
        return node != null && node.isObject() ? node.get(key) : null;
    }

    static boolean isObject(JsonNode node) {
        return node != null && node.isObject();
    }

    static boolean isText(JsonNode node) {
        return node != null && node.isTextual();
    }

    /** Node typeof number with Number.isFinite. */
    static boolean finite(JsonNode node) {
        return node != null && node.isNumber() && Double.isFinite(node.doubleValue());
    }

    /** Node Number.isSafeInteger. */
    static boolean safeInteger(JsonNode node) {
        if (node == null || !node.isNumber()) return false;
        double d = node.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= MAX_SAFE;
    }

    /** Node truthiness of a JSON value (undefined and null are falsy). */
    static boolean truthy(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) return false;
        if (node.isTextual()) return !node.textValue().isEmpty();
        if (node.isBoolean()) return node.booleanValue();
        if (node.isNumber()) return node.doubleValue() != 0 && !Double.isNaN(node.doubleValue());
        return true;
    }

    /** Node `a === b` over JSON values: scalars by value, containers never. */
    static boolean strictEquals(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isContainerNode() || b.isContainerNode()) return false;
        if (a.isNumber() && b.isNumber()) return a.doubleValue() == b.doubleValue();
        return a.equals(b);
    }

    static boolean isString(JsonNode node, String value) {
        return node != null && node.isTextual() && node.textValue().equals(value);
    }

    /** Node Number(value) for the JSON scalars a brief can hold; containers are NaN. */
    static double toNumber(JsonNode node) {
        if (node == null) return Double.NaN;
        if (node.isNull()) return 0;
        if (node.isNumber()) return node.doubleValue();
        if (node.isBoolean()) return node.booleanValue() ? 1 : 0;
        if (node.isArray()) {
            if (node.size() == 0) return 0;
            return node.size() == 1 ? toNumber(node.get(0)) : Double.NaN;
        }
        if (node.isTextual()) {
            String s = node.textValue().strip();
            if (s.isEmpty()) return 0;
            char last = s.charAt(s.length() - 1);
            if (last == 'd' || last == 'D' || last == 'f' || last == 'F' || s.startsWith("0x") || s.startsWith("0X")) return Double.NaN;
            try {
                return Double.parseDouble(s);
            } catch (NumberFormatException e) {
                return Double.NaN;
            }
        }
        return Double.NaN;
    }

    /** Node `value === n` for a JSON number. */
    static boolean isNumberEqual(JsonNode node, double n) {
        return node != null && node.isNumber() && node.doubleValue() == n;
    }

    /** Node `value === true`. */
    static boolean isTrue(JsonNode node) {
        return node != null && node.isBoolean() && node.booleanValue();
    }
}
