package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.TreeSet;

/** Canonical JSON (sorted keys, no whitespace) and its SHA-256 hex digest. */
public final class Canonical {

    private Canonical() {}

    public static String json(JsonNode node) {
        StringBuilder sb = new StringBuilder();
        write(node, sb);
        return sb.toString();
    }

    public static String digest(JsonNode node) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(json(node).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void write(JsonNode n, StringBuilder sb) {
        if (n == null || n.isMissingNode()) {
            sb.append("null");
        } else if (n.isObject()) {
            sb.append('{');
            boolean first = true;
            for (String name : new TreeSet<>(iterable(n))) {
                if (!first) sb.append(',');
                first = false;
                sb.append(new TextNode(name)).append(':');
                write(n.get(name), sb);
            }
            sb.append('}');
        } else if (n.isArray()) {
            sb.append('[');
            for (int i = 0; i < n.size(); i++) {
                if (i > 0) sb.append(',');
                write(n.get(i), sb);
            }
            sb.append(']');
        } else {
            sb.append(n);
        }
    }

    private static java.util.List<String> iterable(JsonNode n) {
        java.util.List<String> names = new java.util.ArrayList<>();
        n.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
