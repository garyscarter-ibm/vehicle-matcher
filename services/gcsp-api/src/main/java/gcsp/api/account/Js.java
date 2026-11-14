package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.regex.Pattern;

/** The few JavaScript semantics the Node service relies on; a Java null stands for JS undefined. */
final class Js {

    private static final BigDecimal MAX_SAFE = new BigDecimal("9007199254740991");
    private static final Pattern INSTANT =
            Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|([+-])(\\d{2}):(\\d{2}))");
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final long DAY_MS = 86_400_000L;

    private Js() {}

    /** Property read: throws on null or undefined bases like a JS TypeError; primitives yield undefined. */
    static JsonNode get(JsonNode base, String key) {
        if (base == null || base.isNull()) throw new IllegalStateException("Cannot read '" + key + "' of nullish");
        return base.isObject() ? base.get(key) : null;
    }

    /** Optional chaining: nullish base yields undefined. */
    static JsonNode opt(JsonNode base, String key) {
        return base == null || base.isNull() ? null : get(base, key);
    }

    static boolean nullish(JsonNode n) {
        return n == null || n.isNull();
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    static boolean array(JsonNode n) {
        return n != null && n.isArray();
    }

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !blank(n.textValue());
    }

    private static boolean blank(String s) {
        for (int i = 0; i < s.length(); i++) if (!whitespace(s.charAt(i))) return false;
        return true;
    }

    private static boolean whitespace(char c) {
        return c == ' ' || c >= '\t' && c <= '\r' || c == '\u00a0' || c == '\u1680' || c >= '\u2000' && c <= '\u200a'
                || c == '\u2028' || c == '\u2029' || c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff';
    }

    static boolean eqStr(JsonNode n, String s) {
        return s == null ? n == null : n != null && n.isTextual() && n.textValue().equals(s);
    }

    /** JS strict equality; distinct objects and arrays are never equal. */
    static boolean strictEq(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isNumber() && b.isNumber()) return a.decimalValue().compareTo(b.decimalValue()) == 0;
        if (a.isNull() && b.isNull()) return true;
        if (a.isContainerNode() || b.isContainerNode()) return false;
        return a.equals(b);
    }

    static boolean includes(JsonNode array, JsonNode value) {
        if (value == null) return false;
        for (JsonNode e : array) if (strictEq(e, value)) return true;
        return false;
    }

    static boolean includes(JsonNode array, String value) {
        for (JsonNode e : array) if (eqStr(e, value)) return true;
        return false;
    }

    static boolean safeInt(JsonNode n) {
        if (n == null || !n.isNumber()) return false;
        BigDecimal d = n.decimalValue();
        return d.abs().compareTo(MAX_SAFE) <= 0 && (d.signum() == 0 || d.stripTrailingZeros().scale() <= 0);
    }

    static boolean truthy(JsonNode n) {
        if (nullish(n)) return false;
        if (n.isBoolean()) return n.booleanValue();
        if (n.isNumber()) return n.decimalValue().signum() != 0;
        if (n.isTextual()) return !n.textValue().isEmpty();
        return true;
    }

    /** Port of policy file-provider validInstant, including the Date.parse finite check. */
    static boolean validInstant(JsonNode n) {
        return n != null && n.isTextual() && epochMillis(n.textValue()) != null;
    }

    /** Epoch millis for a valid instant, else null. */
    static Long epochMillis(String s) {
        var m = INSTANT.matcher(s);
        if (!m.matches()) return null;
        int hour = Integer.parseInt(m.group(4)), minute = Integer.parseInt(m.group(5)), second = Integer.parseInt(m.group(6));
        if (hour >= 24 || minute >= 60 || second >= 60) return null;
        long offset = 0;
        if (m.group(8) != null) {
            int oh = Integer.parseInt(m.group(9)), om = Integer.parseInt(m.group(10));
            if (oh > 23 || om > 59) return null;
            offset = (oh * 60L + om) * 60_000L * (m.group(8).equals("-") ? -1 : 1);
        }
        LocalDate day = day(s.substring(0, 10));
        if (day == null) return null;
        long millis = m.group(7) == null ? 0 : Long.parseLong((m.group(7) + "00").substring(0, 3));
        return day.toEpochDay() * DAY_MS + ((hour * 60L + minute) * 60 + second) * 1000 + millis - offset;
    }

    private static LocalDate day(String v) {
        if (!DAY.matcher(v).matches()) return null;
        try {
            return LocalDate.of(Integer.parseInt(v.substring(0, 4)), Integer.parseInt(v.substring(5, 7)),
                    Integer.parseInt(v.substring(8, 10)));
        } catch (DateTimeException e) {
            return null;
        }
    }

    static boolean calendarDate(JsonNode n) {
        return n != null && n.isTextual() && day(n.textValue()) != null;
    }

    static long midnight(String isoDay) {
        return day(isoDay).toEpochDay() * DAY_MS;
    }

    /** ISO day for epoch millis; years beyond 9999 are refused where JS would print an expanded year. */
    static String isoDay(long millis) {
        LocalDate d = LocalDate.ofEpochDay(Math.floorDiv(millis, DAY_MS));
        if (d.getYear() > 9999) throw new IllegalStateException("date out of range");
        return d.toString();
    }
}
