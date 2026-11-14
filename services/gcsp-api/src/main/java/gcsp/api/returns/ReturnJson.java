package gcsp.api.returns;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.regex.Pattern;

/** Shared JSON mapper and the millisecond ISO instants the Node returns code reads and writes. */
public final class ReturnJson {

    public static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern SHAPE = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$");
    private static final DateTimeFormatter OUT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private ReturnJson() {}

    public static String format(Instant instant) {
        return instant == null ? null : OUT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    /** The instant, or null when the text is not a strict ISO instant with an offset. */
    public static Instant parse(String text) {
        if (text == null || !SHAPE.matcher(text).matches()) return null;
        if (Integer.parseInt(text.substring(11, 13)) >= 24) return null;
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Node's text rule: non-blank, bounded, and no em dash in any stored wording. */
    public static boolean text(String v, int max) {
        return v != null && !v.isBlank() && v.length() <= max && v.indexOf('—') < 0;
    }
}
