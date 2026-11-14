package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.regex.Pattern;

/** Small JSON predicates shared by the brief rules; each treats null (an absent field) as invalid. */
final class Json {

    static final ObjectMapper M = new ObjectMapper();
    private static final Pattern INSTANT =
            Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$");
    private static final double MAX_SAFE = 9007199254740991d;

    private Json() {}

    static ObjectNode obj() {
        return M.createObjectNode();
    }

    static ArrayNode arr() {
        return M.createArrayNode();
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    /** A JSON object whose every field name is one of keys. */
    static boolean only(JsonNode n, String... keys) {
        if (!object(n)) return false;
        Set<String> allowed = Set.of(keys);
        for (var it = n.fieldNames(); it.hasNext();) if (!allowed.contains(it.next())) return false;
        return true;
    }

    /** A string of 1 to 128 characters that is not blank. */
    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank() && n.asText().length() <= 128;
    }

    static boolean integer(JsonNode n) {
        if (n == null || !n.isNumber()) return false;
        double d = n.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= MAX_SAFE;
    }

    static boolean revision(JsonNode n) {
        return integer(n) && n.doubleValue() >= 0;
    }

    static boolean instant(JsonNode n) {
        if (n == null || !n.isTextual() || !INSTANT.matcher(n.asText()).matches()) return false;
        String v = n.asText();
        try {
            LocalDate.parse(v.substring(0, 10));
        } catch (DateTimeParseException e) {
            return false;
        }
        return Integer.parseInt(v.substring(11, 13)) < 24 && Integer.parseInt(v.substring(14, 16)) < 60
                && Integer.parseInt(v.substring(17, 19)) < 60;
    }

    /** Equality where an absent field differs from an explicit null. */
    static boolean same(JsonNode a, JsonNode b) {
        return a == null ? b == null : a.equals(b);
    }

    static boolean flag(JsonNode n, String field) {
        return n != null && n.path(field).isBoolean() && n.get(field).booleanValue();
    }

    static boolean contains(JsonNode array, JsonNode value) {
        if (array == null || !array.isArray() || value == null) return false;
        for (JsonNode v : array) if (v.equals(value)) return true;
        return false;
    }

    static int indexOf(JsonNode array, JsonNode value) {
        for (int i = 0; i < array.size(); i++) if (array.get(i).equals(value)) return i;
        return -1;
    }
}
