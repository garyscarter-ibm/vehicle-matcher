package gcsp.api.approvals;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/** Instants as the Node lifecycle writes them: millisecond ISO text in UTC. */
final class Time {

    private static final DateTimeFormatter OUT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

    private Time() {}

    static String format(Instant instant) {
        return instant == null ? null : OUT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    /** The instant, or null when the text is absent or not ISO. */
    static Instant parse(String text) {
        if (text == null) return null;
        try {
            return Instant.parse(text);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }
}
