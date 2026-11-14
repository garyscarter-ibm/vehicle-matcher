package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.regex.Pattern;

/** Small JSON and instant helpers for the case rules; absent or mistyped fields are simply invalid. */
final class CaseJson {

    static final ObjectMapper M = new ObjectMapper();
    private static final Pattern INSTANT =
            Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final DateTimeFormatter OUT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final double MAX_SAFE = 9007199254740991d;

    private CaseJson() {}

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

    /** A non-blank string of at most max characters. */
    static boolean text(JsonNode n, int max) {
        return n != null && n.isTextual() && !n.asText().isBlank() && n.asText().length() <= max;
    }

    static boolean text(String s, int max) {
        return s != null && !s.isBlank() && s.length() <= max;
    }

    static boolean integer(JsonNode n) {
        if (n == null || !n.isNumber()) return false;
        double d = n.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= MAX_SAFE;
    }

    /** The strict ISO instant (offset required, hours below 24), or null. */
    static Instant instant(String text) {
        if (text == null || !INSTANT.matcher(text).matches() || Integer.parseInt(text.substring(11, 13)) >= 24) return null;
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    static Instant instant(JsonNode n) {
        return n != null && n.isTextual() ? instant(n.textValue()) : null;
    }

    /** A real calendar day written YYYY-MM-DD, or null. */
    static LocalDate date(String text) {
        if (text == null || !DATE.matcher(text).matches()) return null;
        try {
            return LocalDate.parse(text);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    static String iso(Instant instant) {
        return OUT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }
}
