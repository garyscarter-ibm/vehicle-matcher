package gcsp.api.clock;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

/** SHA-256 text digests and the id shapes the clock accepts. */
final class Digests {

    private static final Pattern TICK_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$");

    private Digests() {}

    static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static boolean validTickId(String tickId) {
        return tickId != null && TICK_ID.matcher(tickId).matches();
    }

    static boolean validCommandId(String commandId) {
        return Instants.text(commandId, 128) && commandId.equals(commandId.strip());
    }
}
