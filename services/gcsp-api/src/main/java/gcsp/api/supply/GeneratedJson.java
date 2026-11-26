package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import gcsp.api.evidence.CanonicalJson;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Collator;
import java.util.*;

/** The generator's Node wire semantics: compact JSON, numeric values and hash ordinals. */
final class GeneratedJson {
    static final JsonNodeFactory F = JsonNodeFactory.instance;
    private GeneratedJson() {}

    static ObjectNode obj(Object... pairs) {
        ObjectNode out = F.objectNode();
        for (int i = 0; i < pairs.length; i += 2) out.set((String) pairs[i], node(pairs[i + 1]));
        return out;
    }

    static ArrayNode arr(Object... items) {
        ArrayNode out = F.arrayNode();
        for (Object item : items) out.add(node(item));
        return out;
    }

    static JsonNode node(Object value) {
        if (value == null) return F.nullNode();
        if (value instanceof JsonNode n) return n;
        if (value instanceof String s) return F.textNode(s);
        if (value instanceof Boolean b) return F.booleanNode(b);
        if (value instanceof Number n) {
            double d = n.doubleValue();
            if (d == Math.rint(d) && Math.abs(d) <= 9007199254740991d) {
                long l = (long) d;
                return l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE ? F.numberNode((int) l) : F.numberNode(l);
            }
            return F.numberNode(d);
        }
        if (value instanceof Collection<?> c) {
            ArrayNode out = F.arrayNode(); c.forEach(v -> out.add(node(v))); return out;
        }
        throw new IllegalArgumentException("Not JSON data");
    }

    static List<JsonNode> list(JsonNode node) {
        List<JsonNode> out = new ArrayList<>(); node.forEach(out::add); return out;
    }

    static List<String> names(JsonNode node) {
        List<String> out = new ArrayList<>(); node.fieldNames().forEachRemaining(out::add); return out;
    }

    static boolean text(JsonNode node) { return node.isTextual() && !node.asText().isBlank() && node.asText().length() <= 512; }
    static boolean integer(JsonNode n) { return n.isNumber() && Double.isFinite(n.asDouble()) && Math.abs(n.asDouble()) <= 9007199254740991d && n.asDouble() == Math.rint(n.asDouble()); }
    static boolean positive(JsonNode n) { return integer(n) && n.asDouble() > 0; }
    static boolean exact(JsonNode n, String... keys) { return n.isObject() && names(n).size() == keys.length && names(n).containsAll(List.of(keys)); }
    static boolean allowed(JsonNode n, String... keys) { return n.isObject() && List.of(keys).containsAll(names(n)); }

    static Comparator<String> localeOrder() {
        Collator collator = Collator.getInstance(Locale.ENGLISH);
        collator.setStrength(Collator.TERTIARY);
        return collator::compare;
    }

    static ArrayNode append(JsonNode source, Object... tail) {
        ArrayNode out = (ArrayNode) source.deepCopy();
        for (Object value : tail) out.add(node(value));
        return out;
    }

    static String digest(JsonNode value) { return CanonicalJson.digest(value); }
    static long ordinal(JsonNode parts, long size) {
        return new BigInteger(1, Arrays.copyOf(hash(json(parts, false)), 8)).mod(BigInteger.valueOf(size)).longValue();
    }
    static byte[] hash(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    static String json(JsonNode n, boolean canonical) {
        if (canonical) return CanonicalJson.canonical(n);
        if (n.isObject()) {
            List<String> keys = names(n);
            List<String> parts = new ArrayList<>();
            for (String key : keys) parts.add(F.textNode(key) + ":" + json(n.path(key), canonical));
            return "{" + String.join(",", parts) + "}";
        }
        if (n.isArray()) {
            List<String> parts = new ArrayList<>(); n.forEach(v -> parts.add(json(v, canonical)));
            return "[" + String.join(",", parts) + "]";
        }
        return n.isMissingNode() ? "null" : CanonicalJson.canonical(n);
    }

    static final class Refusal extends RuntimeException {
        final String status;
        final String code;
        final String reason;
        Refusal(String status, String code, String reason) { this.status = status; this.code = code; this.reason = reason; }
    }
    static void invalid(String code) { throw new Refusal("invalid", code, null); }
    static void unavailable(String code) { throw new Refusal("unavailable", code, null); }
}
