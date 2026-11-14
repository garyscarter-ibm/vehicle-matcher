package gcsp.api.allocation;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** The seeded tie-break: SHA-256 hex of the exact text JSON.stringify makes of [seed, runId, employeeId, orderUuid]. */
final class Lottery {

    private Lottery() {}

    static String of(String seed, String runId, String employeeId, String orderUuid) {
        StringBuilder sb = new StringBuilder("[");
        string(sb, seed);
        for (String s : new String[] {runId, employeeId, orderUuid}) {
            sb.append(',');
            string(sb, s);
        }
        sb.append(']');
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** JSON.stringify's string form: short escapes, lower-case \\u00xx for other controls and lone surrogates. */
    static void string(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (Character.isHighSurrogate(ch) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) {
                        sb.append(ch).append(s.charAt(++i));
                    } else if (ch < 0x20 || Character.isSurrogate(ch)) {
                        sb.append(String.format("\\u%04x", (int) ch));
                    } else {
                        sb.append(ch);
                    }
                }
            }
        }
        sb.append('"');
    }
}
