package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;

/**
 * SHA-256 of JSON.stringify(canonical(value)) as Node computes it: sorted keys with array-index keys first,
 * JavaScript number and string formatting. Same shape as the policy digest, exact for numbers and keys.
 */
final class PlanDigest {

    private PlanDigest() {
    }

    static String of(JsonNode node) {
        StringBuilder sb = new StringBuilder();
        write(node, sb);
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void write(JsonNode n, StringBuilder sb) {
        if (n == null || n.isMissingNode() || n.isNull()) {
            sb.append("null");
        } else if (n.isObject()) {
            List<String> names = new ArrayList<>();
            n.fieldNames().forEachRemaining(names::add);
            Collections.sort(names);
            List<String> ordered = new ArrayList<>();
            names.stream().filter(PlanDigest::index).sorted((a, b) -> Long.compare(Long.parseLong(a), Long.parseLong(b)))
                    .forEach(ordered::add);
            names.stream().filter(s -> !index(s)).forEach(ordered::add);
            sb.append('{');
            for (int i = 0; i < ordered.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                quote(ordered.get(i), sb);
                sb.append(':');
                write(n.get(ordered.get(i)), sb);
            }
            sb.append('}');
        } else if (n.isArray()) {
            sb.append('[');
            for (int i = 0; i < n.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                write(n.get(i), sb);
            }
            sb.append(']');
        } else if (n.isNumber()) {
            sb.append(JsNum.str(n.doubleValue()));
        } else if (n.isBoolean()) {
            sb.append(n.booleanValue());
        } else {
            quote(n.asText(), sb);
        }
    }

    /** A JavaScript array index key: canonical decimal below 2^32 - 1. */
    private static boolean index(String s) {
        if (s.isEmpty() || s.length() > 10 || !s.chars().allMatch(c -> c >= '0' && c <= '9') || (s.length() > 1 && s.charAt(0) == '0')) {
            return false;
        }
        return Long.parseLong(s) < 4294967295L;
    }

    /** JSON.stringify string escaping (well-formed: lone surrogates become lowercase \\u escapes). */
    private static void quote(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else if (Character.isHighSurrogate(c) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) {
                        sb.append(c).append(s.charAt(++i));
                    } else if (Character.isSurrogate(c)) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}
