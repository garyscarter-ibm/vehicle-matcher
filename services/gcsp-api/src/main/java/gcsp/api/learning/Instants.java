package gcsp.api.learning;

import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Node validInstant (policy/file-provider.js): ISO instants with a real day and a Date.parse-able offset. */
final class Instants {

    private static final Pattern INSTANT = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|([+-])(\\d{2}):(\\d{2}))");

    private Instants() {}

    static boolean valid(String value) {
        if (value == null) return false;
        Matcher m = INSTANT.matcher(value);
        if (!m.matches()) return false;
        int month = Integer.parseInt(m.group(2));
        if (month < 1 || month > 12) return false;
        int day = Integer.parseInt(m.group(3));
        if (day < 1 || day > YearMonth.of(Integer.parseInt(m.group(1)), month).lengthOfMonth()) return false;
        if (Integer.parseInt(m.group(4)) >= 24 || Integer.parseInt(m.group(5)) >= 60 || Integer.parseInt(m.group(6)) >= 60) return false;
        // Date.parse is NaN for an offset beyond 23:59.
        return m.group(8) == null || (Integer.parseInt(m.group(9)) <= 23 && Integer.parseInt(m.group(10)) <= 59);
    }

    /** Node Date.parse in epoch milliseconds, for a string that {@link #valid} accepts. */
    static long parse(String value) {
        Matcher m = INSTANT.matcher(value);
        if (!m.matches()) throw new IllegalArgumentException("Not an instant: " + value);
        LocalDateTime local = LocalDateTime.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)),
                Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), Integer.parseInt(m.group(6)));
        long offset = m.group(8) == null ? 0
                : (m.group(8).equals("-") ? -1 : 1) * (Integer.parseInt(m.group(9)) * 3600L + Integer.parseInt(m.group(10)) * 60L);
        long millis = m.group(7) == null ? 0 : Long.parseLong((m.group(7) + "00").substring(0, 3));
        return (local.toEpochSecond(ZoneOffset.UTC) - offset) * 1000 + millis;
    }
}
