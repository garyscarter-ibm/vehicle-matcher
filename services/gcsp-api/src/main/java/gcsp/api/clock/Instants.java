package gcsp.api.clock;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.regex.Pattern;

/** Instants as the Node clock writes and validates them: millisecond ISO text, strict input shape. */
final class Instants {

    /** The latest instant the clock accepts, so four-digit years always format. */
    static final Instant MAX = Instant.parse("9999-12-31T23:59:59.999Z");
    private static final Pattern SHAPE = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$");
    private static final DateTimeFormatter OUT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

    private Instants() {}

    static String format(Instant instant) {
        return OUT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    /** The instant, or null when the text is not a valid ISO instant with an offset. */
    static Instant parse(String text) {
        if (text == null || !SHAPE.matcher(text).matches()) return null;
        if (Integer.parseInt(text.substring(11, 13)) >= 24) return null;
        try {
            Instant at = OffsetDateTime.parse(text).toInstant();
            return at.isAfter(MAX) ? null : at;
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** JavaScript trim().length > 0 within a length limit. */
    static boolean text(String value, int max) {
        return value != null && !value.isBlank() && value.length() <= max;
    }
}
