package gcsp.api.evidence;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.regex.Pattern;

/** Format-only canonical identifiers; no unknown VIN is assigned a market, checksum or year profile. */
public final class VehicleIdentifiers {

    private static final Pattern BASE64 = Pattern.compile("[A-Za-z0-9+/]+={0,2}");
    private static final Pattern SIGNATURE =
            Pattern.compile("[A-Z0-9]{2,16}:[A-Z0-9]{2,16}(?:,[A-Z0-9]{2,16})*");
    private static final Pattern STOCK =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    private static final Pattern VIN = Pattern.compile("[A-HJ-NPR-Z0-9]{17}");

    private VehicleIdentifiers() {}

    /** The canonical id for the kind, or null when the id is not a canonical identifier of that kind. */
    public static String canonical(String kind, String id) {
        if ("configuration".equals(kind)) return configuration(id);
        if ("stock".equals(kind)) return id != null && STOCK.matcher(id).matches() ? id : null;
        if (!"vin".equals(kind) || id == null || id.length() > 4096) return null;
        StringBuilder upper = new StringBuilder(jsTrim(id));
        for (int i = 0; i < upper.length(); i++) {
            char c = upper.charAt(i);
            if (c >= 'a' && c <= 'z') upper.setCharAt(i, (char) (c - 32));
        }
        String vin = upper.toString();
        return VIN.matcher(vin).matches() ? vin : null;
    }

    private static String configuration(String id) {
        if (id == null || id.length() > 8192 || id.length() % 4 != 0 || !BASE64.matcher(id).matches()) return null;
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(id);
        } catch (IllegalArgumentException e) {
            return null;
        }
        // Node replaces invalid UTF-8 then re-encodes, which can never reproduce the input, so strict decoding agrees.
        String decoded;
        try {
            decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
        if (!Base64.getEncoder().encodeToString(decoded.getBytes(StandardCharsets.UTF_8)).equals(id)
                || !SIGNATURE.matcher(decoded).matches()) return null;
        int colon = decoded.indexOf(':');
        String[] codes = decoded.substring(colon + 1).split(",", -1);
        String[] sorted = codes.clone();
        Arrays.sort(sorted);
        boolean ok = codes.length <= 256 && new HashSet<>(Arrays.asList(codes)).size() == codes.length
                && Arrays.equals(codes, sorted);
        return ok ? id : null;
    }

    /** ECMAScript String.prototype.trim: WhiteSpace and LineTerminator code points. */
    static String jsTrim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && jsSpace(s.charAt(start))) start++;
        while (end > start && jsSpace(s.charAt(end - 1))) end--;
        return s.substring(start, end);
    }

    private static boolean jsSpace(char c) {
        return c == 0x20 || (c >= 0x09 && c <= 0x0d) || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a)
                || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
    }
}
