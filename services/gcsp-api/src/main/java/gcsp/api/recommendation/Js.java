package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** The JavaScript semantics the Node recommendation code relies on; a Java null reference stands for JS undefined. */
final class Js {

    static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern INSTANT =
            Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|([+-])(\\d{2}):(\\d{2}))");
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?");
    private static final double MAX_SAFE = 9007199254740991d;

    private Js() {}

    static ObjectNode obj() {
        return F.objectNode();
    }

    static ArrayNode arr() {
        return F.arrayNode();
    }

    /** Property read: a nullish base throws like a JS TypeError; a non-object base yields undefined. */
    static JsonNode get(JsonNode base, String key) {
        if (base == null || base.isNull()) throw new RecommendationFault("Cannot read '" + key + "' of nullish");
        return base.isObject() ? base.get(key) : null;
    }

    /** Chained property reads a.b.c, each step throwing on a nullish base. */
    static JsonNode at(JsonNode base, String... keys) {
        JsonNode node = base;
        for (String key : keys) node = get(node, key);
        return node;
    }

    /** An array the JS code calls .filter or .some on; anything else is a TypeError. */
    static JsonNode array(JsonNode n) {
        if (n == null || !n.isArray()) throw new RecommendationFault("not an array");
        return n;
    }

    /** Optional chaining: a nullish base yields undefined. */
    static JsonNode opt(JsonNode base, String key) {
        return base == null || base.isNull() ? null : get(base, key);
    }

    static boolean nullish(JsonNode n) {
        return n == null || n.isNull();
    }

    static JsonNode orNull(JsonNode n) {
        return n == null ? F.nullNode() : n;
    }

    /** Own-property test on a plain object (Object.hasOwn). */
    static boolean has(JsonNode base, String key) {
        return base != null && base.isObject() && base.has(key);
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
        return n != null && n.isTextual() && n.textValue().equals(s);
    }

    static boolean isBool(JsonNode n) {
        return n != null && n.isBoolean();
    }

    static boolean eqBool(JsonNode n, boolean b) {
        return n != null && n.isBoolean() && n.booleanValue() == b;
    }

    /** Plain object test (the Node `object` helper). */
    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    static boolean includes(List<String> list, JsonNode value) {
        return value != null && value.isTextual() && list.contains(value.textValue());
    }

    /** Number.isFinite: only an actual number counts. */
    static boolean finite(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.doubleValue());
    }

    static boolean isInteger(JsonNode n) {
        return finite(n) && integral(n.doubleValue());
    }

    static boolean safeInt(JsonNode n) {
        return isInteger(n) && Math.abs(n.doubleValue()) <= MAX_SAFE;
    }

    static boolean integral(double d) {
        return Double.isFinite(d) && d == Math.floor(d);
    }

    /** JS truthiness of a JSON value (objects and arrays are truthy). */
    static boolean truthy(JsonNode n) {
        if (nullish(n)) return false;
        if (n.isBoolean()) return n.booleanValue();
        if (n.isNumber()) return truthy(n.doubleValue());
        if (n.isTextual()) return !n.textValue().isEmpty();
        return true;
    }

    static boolean truthy(double d) {
        return d != 0 && !Double.isNaN(d);
    }

    /** JS ===; distinct objects and arrays are never equal, and a null reference (undefined) differs from JSON null. */
    static boolean strictEq(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isNumber() && b.isNumber()) return a.doubleValue() == b.doubleValue();
        if (a.isContainerNode() || b.isContainerNode()) return false;
        return a.equals(b);
    }

    /** Array.prototype.includes; a non-array base is a TypeError (strings are outside the parity contract). */
    static boolean includes(JsonNode array, JsonNode value) {
        if (array == null || !array.isArray()) throw new RecommendationFault("includes is not a function");
        for (JsonNode e : array) if (strictEq(e, value)) return true;
        return false;
    }

    static boolean includes(JsonNode array, String value) {
        if (array == null || !array.isArray()) throw new RecommendationFault("includes is not a function");
        for (JsonNode e : array) if (eqStr(e, value)) return true;
        return false;
    }

    static boolean listHas(List<JsonNode> list, JsonNode value) {
        for (JsonNode e : list) if (strictEq(e, value)) return true;
        return false;
    }

    /** Object.entries: arrays and strings list their indexes, other primitives nothing; objects put canonical array-index keys first (ascending), then insertion order. */
    static List<Map.Entry<String, JsonNode>> entries(JsonNode n) {
        if (nullish(n)) throw new RecommendationFault("Cannot convert undefined or null to object");
        if (n.isArray()) {
            List<Map.Entry<String, JsonNode>> items = new ArrayList<>();
            for (int i = 0; i < n.size(); i++) items.add(Map.entry(Integer.toString(i), n.get(i)));
            return items;
        }
        if (n.isTextual()) {
            List<Map.Entry<String, JsonNode>> chars = new ArrayList<>();
            String text = n.textValue();
            for (int i = 0; i < text.length(); i++) chars.add(Map.entry(Integer.toString(i), F.textNode(text.substring(i, i + 1))));
            return chars;
        }
        if (!n.isObject()) return new ArrayList<>();
        List<Map.Entry<String, JsonNode>> indexes = new ArrayList<>();
        List<Map.Entry<String, JsonNode>> others = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> it = n.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            (isIndex(e.getKey()) ? indexes : others).add(Map.entry(e.getKey(), e.getValue()));
        }
        indexes.sort(Comparator.comparingLong(e -> Long.parseLong(e.getKey())));
        indexes.addAll(others);
        return indexes;
    }

    private static boolean isIndex(String k) {
        if (k.isEmpty() || k.length() > 10 || !k.chars().allMatch(c -> c >= '0' && c <= '9')) return false;
        return (k.equals("0") || k.charAt(0) != '0') && Long.parseLong(k) <= 4294967294L;
    }

    /** Object.hasOwn(base, key): a nullish base throws; arrays own their indexes and length, other primitives nothing. */
    static boolean hasOwn(JsonNode base, String key) {
        if (nullish(base)) throw new RecommendationFault("Cannot convert undefined or null to object");
        if (base.isArray()) return key.equals("length") || isIndex(key) && Long.parseLong(key) < base.size();
        return base.isObject() && base.has(key);
    }

    /** base[key] for objects and arrays (undefined otherwise); a nullish base throws. */
    static JsonNode prop(JsonNode base, String key) {
        if (nullish(base)) throw new RecommendationFault("Cannot read '" + key + "' of nullish");
        if (base.isArray()) return isIndex(key) && Long.parseLong(key) < base.size() ? base.get((int) Long.parseLong(key)) : null;
        return base.isObject() ? base.get(key) : null;
    }

    /** Object.keys(base).length for a plain object. */
    static int keyCount(JsonNode base) {
        if (nullish(base)) throw new RecommendationFault("Cannot convert undefined or null to object");
        return base.isObject() ? base.size() : 0;
    }

    /** Fluent object builder that leaves out undefined (null reference) fields like JSON.stringify. */
    static final class B {
        private final ObjectNode n = F.objectNode();

        B s(String k, JsonNode v) {
            if (v != null) n.set(k, v);
            return this;
        }

        B s(String k, String v) {
            n.put(k, v);
            return this;
        }

        B s(String k, double v) {
            n.set(k, num(v));
            return this;
        }

        B s(String k, boolean v) {
            n.put(k, v);
            return this;
        }

        ObjectNode build() {
            return n;
        }
    }

    /** Property key for a JSON value used as a computed key. */
    static String key(JsonNode n) {
        return toStr(n);
    }

    /** JS Number(): plain numbers, null, booleans and decimal strings; other shapes yield NaN. */
    static double toNumber(JsonNode n) {
        if (n == null) return Double.NaN;
        if (n.isNumber()) return n.doubleValue();
        if (n.isNull()) return 0;
        if (n.isBoolean()) return n.booleanValue() ? 1 : 0;
        if (n.isTextual()) return parse(n.textValue());
        return parse(toStr(n));
    }

    /** JS String() of a JSON value: arrays join their elements with commas, objects are "[object Object]". */
    static String toStr(JsonNode n) {
        if (n == null) return "undefined";
        if (n.isArray()) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < n.size(); i++) {
                if (i > 0) sb.append(',');
                JsonNode e = n.get(i);
                if (!e.isNull()) sb.append(toStr(e));
            }
            return sb.toString();
        }
        if (n.isObject()) return "[object Object]";
        if (n.isNumber()) {
            double d = n.doubleValue();
            return d == Math.rint(d) && Math.abs(d) < 1e21 ? Long.toString((long) d) : Double.toString(d);
        }
        return n.asText();
    }

    /** Abstract relational comparison: negative, zero or positive, or NaN when unordered (a NaN operand). */
    static double rel(JsonNode a, JsonNode b) {
        if (a != null && b != null && a.isTextual() && b.isTextual()) return Integer.signum(a.textValue().compareTo(b.textValue()));
        return rel(toNumber(a), toNumber(b));
    }

    static double rel(double a, double b) {
        return Double.isNaN(a) || Double.isNaN(b) ? Double.NaN : a < b ? -1 : a > b ? 1 : 0;
    }

    static double rel(JsonNode a, double b) {
        return rel(toNumber(a), b);
    }

    static double rel(double a, JsonNode b) {
        return rel(a, toNumber(b));
    }

    /** A value the JS code destructures or indexes; null (undefined or a missing range) throws like a TypeError. */
    static <T> T requireNonNull(T value) {
        if (value == null) throw new RecommendationFault("Cannot destructure a nullish value");
        return value;
    }

    /** Destructuring source: nullish throws like a JS TypeError, anything else is returned. */
    static JsonNode destructure(JsonNode n) {
        if (nullish(n)) throw new RecommendationFault("Cannot destructure a nullish value");
        return n;
    }

    private static double parse(String raw) {
        int start = 0;
        int end = raw.length();
        while (start < end && whitespace(raw.charAt(start))) start++;
        while (end > start && whitespace(raw.charAt(end - 1))) end--;
        String s = raw.substring(start, end);
        if (s.isEmpty()) return 0;
        if (s.equals("Infinity") || s.equals("+Infinity")) return Double.POSITIVE_INFINITY;
        if (s.equals("-Infinity")) return Double.NEGATIVE_INFINITY;
        return DECIMAL.matcher(s).matches() ? Double.parseDouble(s) : Double.NaN;
    }

    /** Math.round: nearest integer, ties toward +Infinity, exact for every double. */
    static double round(double x) {
        if (!Double.isFinite(x)) return x;
        double floor = Math.floor(x);
        double r = x - floor >= 0.5 ? floor + 1 : floor;
        return r == 0 && (x < 0 || 1 / x < 0) ? -0.0 : r;
    }

    /** Math.min(hi, Math.max(lo, v)), the retail dimension clamp. */
    static double clamp(double v, double lo, double hi) {
        return Math.min(hi, Math.max(lo, v));
    }

    /** Math.max(lo, Math.min(hi, v)), the clamp used by option evidence and preference scoring. */
    static double clampHigh(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** A number as JSON.stringify would write it: integers stay integers, NaN and Infinity become null. */
    static JsonNode num(double d) {
        if (!Double.isFinite(d)) return F.nullNode();
        if (d == Math.rint(d) && Math.abs(d) <= MAX_SAFE) return F.numberNode((long) d);
        return F.numberNode(d);
    }

    /** Port of the policy file-provider validInstant, including the Date.parse finite check. */
    static boolean validInstant(JsonNode n) {
        return n != null && n.isTextual() && epochMillis(n.textValue()) != null;
    }

    private static Long epochMillis(String s) {
        var m = INSTANT.matcher(s);
        if (!m.matches()) return null;
        int hour = Integer.parseInt(m.group(4));
        int minute = Integer.parseInt(m.group(5));
        int second = Integer.parseInt(m.group(6));
        if (hour >= 24 || minute >= 60 || second >= 60) return null;
        long offset = 0;
        if (m.group(8) != null) {
            int oh = Integer.parseInt(m.group(9));
            int om = Integer.parseInt(m.group(10));
            if (oh > 23 || om > 59) return null;
            offset = (oh * 60L + om) * 60_000L * (m.group(8).equals("-") ? -1 : 1);
        }
        LocalDate day = day(s.substring(0, 10));
        if (day == null) return null;
        long millis = m.group(7) == null ? 0 : Long.parseLong((m.group(7) + "00").substring(0, 3));
        return day.toEpochDay() * 86_400_000L + ((hour * 60L + minute) * 60 + second) * 1000 + millis - offset;
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

    /** True when every field name of the object is in the allowed list (the Node `only` helper, plain objects only). */
    static boolean only(JsonNode value, List<String> fields) {
        if (value == null || !value.isObject()) return false;
        Iterator<String> names = value.fieldNames();
        while (names.hasNext()) if (!fields.contains(names.next())) return false;
        return true;
    }
}
