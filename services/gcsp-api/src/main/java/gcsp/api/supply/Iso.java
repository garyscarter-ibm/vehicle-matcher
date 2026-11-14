package gcsp.api.supply;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.regex.Pattern;

/** Instants as the Node stock port writes and validates them: millisecond ISO text, strict input shape. */
final class Iso {

    private static final Pattern SHAPE = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$");
    private static final DateTimeFormatter OUT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

    private Iso() {}

    static String format(Instant instant) {
        return OUT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    /** The instant, or null when the text is not a valid ISO instant with an offset. */
    static Instant parse(String text) {
        if (text == null || !SHAPE.matcher(text).matches()) return null;
        if (Integer.parseInt(text.substring(11, 13)) >= 24) return null;
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
