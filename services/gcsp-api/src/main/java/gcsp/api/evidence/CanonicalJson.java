package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.MathContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Byte-exact port of Node inputDigest/canonicalContent; integer-like keys sort first, numerically, as in V8. */
public final class CanonicalJson {

    private static final Set<String> FORBIDDEN_KEYS = Set.of("__proto__", "prototype", "constructor");
    private static final long MAX_ARRAY_INDEX = 4294967294L;

    private CanonicalJson() {}

    /** The canonical JSON text without a trailing newline. */
    public static String canonical(JsonNode node) {
        StringBuilder out = new StringBuilder(256);
        write(node, out);
        return out.toString();
    }

    /** Node canonicalContent: the canonical text plus a newline. */
    public static String content(JsonNode node) {
        return canonical(node) + "\n";
    }

    /** Node inputDigest: sha256 hex of the canonical text. */
    public static String digest(JsonNode node) {
        return sha256Hex(canonical(node).getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256Hex(byte[] bytes) {
        return HexFormat.of().formatHex(sha256().digest(bytes));
    }

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void write(JsonNode node, StringBuilder out) {
        if (node == null || node.isNull()) {
            out.append("null");
        } else if (node.isObject()) {
            writeObject(node, out);
        } else if (node.isArray()) {
            out.append('[');
            for (int i = 0; i < node.size(); i++) {
                if (i > 0) out.append(',');
                write(node.get(i), out);
            }
            out.append(']');
        } else if (node.isTextual()) {
            writeString(node.textValue(), out);
        } else if (node.isBoolean()) {
            out.append(node.booleanValue() ? "true" : "false");
        } else if (node.isNumber()) {
            out.append(numberToString(node.doubleValue()));
        } else {
            throw new IllegalArgumentException("Digest input must be JSON data");
        }
    }

    private static void writeObject(JsonNode node, StringBuilder out) {
        List<String> indexKeys = new ArrayList<>();
        List<String> otherKeys = new ArrayList<>();
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            String key = it.next();
            if (FORBIDDEN_KEYS.contains(key)) throw new IllegalArgumentException("Digest input must be JSON data");
            (isArrayIndex(key) ? indexKeys : otherKeys).add(key);
        }
        indexKeys.sort((a, b) -> Long.compare(Long.parseLong(a), Long.parseLong(b)));
        Collections.sort(otherKeys);
        out.append('{');
        boolean first = true;
        for (List<String> keys : List.of(indexKeys, otherKeys)) {
            for (String key : keys) {
                if (!first) out.append(',');
                first = false;
                writeString(key, out);
                out.append(':');
                write(node.get(key), out);
            }
        }
        out.append('}');
    }

    private static boolean isArrayIndex(String key) {
        int n = key.length();
        if (n == 0 || n > 10 || (n > 1 && key.charAt(0) == '0')) return false;
        for (int i = 0; i < n; i++) {
            if (key.charAt(i) < '0' || key.charAt(i) > '9') return false;
        }
        return Long.parseLong(key) <= MAX_ARRAY_INDEX;
    }

    private static void writeString(String s, StringBuilder out) {
        out.append('"');
        int n = s.length();
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        unicodeEscape(c, out);
                    } else if (Character.isHighSurrogate(c) && i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) {
                        out.append(c).append(s.charAt(++i));
                    } else if (Character.isSurrogate(c)) {
                        unicodeEscape(c, out);
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    private static void unicodeEscape(char c, StringBuilder out) {
        out.append("\\u").append(String.format("%04x", (int) c));
    }

    /** ECMAScript Number::toString for a finite double. */
    static String numberToString(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("Digest input must be JSON data");
        if (d == 0) return "0";
        StringBuilder sb = new StringBuilder();
        if (d < 0) {
            sb.append('-');
            d = -d;
        }
        // Double.toString is shortest on Java 19+ but prints two digits where one suffices (4.9E-324).
        BigDecimal decimal = new BigDecimal(Double.toString(d)).stripTrailingZeros();
        if (decimal.precision() == 2) {
            BigDecimal one = decimal.round(new MathContext(1));
            if (Double.parseDouble(one.toString()) == d) decimal = one.stripTrailingZeros();
        }
        String digits = decimal.unscaledValue().toString();
        int k = digits.length();
        int n = k - decimal.scale();
        if (k <= n && n <= 21) {
            sb.append(digits).append("0".repeat(n - k));
        } else if (0 < n && n <= 21) {
            sb.append(digits, 0, n).append('.').append(digits, n, k);
        } else if (-6 < n && n <= 0) {
            sb.append("0.").append("0".repeat(-n)).append(digits);
        } else {
            int exponent = n - 1;
            sb.append(digits.charAt(0));
            if (k > 1) sb.append('.').append(digits, 1, k);
            sb.append('e').append(exponent < 0 ? '-' : '+').append(Math.abs(exponent));
        }
        return sb.toString();
    }
}
