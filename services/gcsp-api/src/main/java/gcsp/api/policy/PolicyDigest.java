package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;

/** SHA-256 of canonical JSON (sorted keys, numbers by value) so a jsonb round trip never changes a digest. */
final class PolicyDigest {

    private PolicyDigest() {
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
            sb.append('{');
            for (int i = 0; i < names.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(com.fasterxml.jackson.databind.node.TextNode.valueOf(names.get(i))).append(':');
                write(n.get(names.get(i)), sb);
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
            sb.append(n.decimalValue().stripTrailingZeros().toPlainString());
        } else {
            sb.append(n);
        }
    }
}
