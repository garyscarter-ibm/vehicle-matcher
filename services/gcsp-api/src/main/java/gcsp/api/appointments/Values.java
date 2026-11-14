package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;

/** The Node loaders' small value checks (text, integer, object) over Jackson nodes. */
final class Values {

    private Values() {}

    static boolean missing(JsonNode n) {
        return n == null || n.isMissingNode() || n.isNull();
    }

    /** Non-blank text within max characters and without an em dash (house style for on-screen copy). */
    static boolean text(JsonNode n, int max) {
        return n != null && n.isTextual() && text(n.asText(), max);
    }

    static boolean text(String s, int max) {
        return s != null && !s.strip().isEmpty() && s.length() <= max && s.indexOf('—') < 0;
    }

    /** Non-empty text within max characters (ids and references, no style rule). */
    static boolean id(JsonNode n, int max) {
        return n != null && n.isTextual() && !n.asText().isEmpty() && n.asText().length() <= max;
    }

    static boolean id(String s, int max) {
        return s != null && !s.isEmpty() && s.length() <= max;
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    /** The integral value, or null; a float with an integral value counts (as in JavaScript). */
    static Long integer(JsonNode n) {
        if (n == null || !n.isNumber()) return null;
        if (n.isIntegralNumber()) return n.canConvertToLong() ? n.longValue() : null;
        double d = n.doubleValue();
        return d == Math.rint(d) && Math.abs(d) <= 9007199254740991.0 ? (long) d : null;
    }

    static boolean integerIn(JsonNode n, long min, long max) {
        Long v = integer(n);
        return v != null && v >= min && v <= max;
    }
}
