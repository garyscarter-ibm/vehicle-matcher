package gcsp.api.policy;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.OptionalLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Instant and day rules of the Node baseline, with Date.parse results as epoch millis. */
final class PolicyTime {

    private static final Pattern INSTANT = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|([+-])(\\d{2}):(\\d{2}))");
    private static final Pattern DAY = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})");

    private PolicyTime() {
    }

    static boolean validDay(String value) {
        if (value == null) {
            return false;
        }
        Matcher m = DAY.matcher(value);
        return m.matches() && dayExists(m);
    }

    private static boolean dayExists(Matcher m) {
        int month = Integer.parseInt(m.group(2));
        if (month < 1 || month > 12) {
            return false;
        }
        int day = Integer.parseInt(m.group(3));
        return day >= 1 && day <= YearMonth.of(Integer.parseInt(m.group(1)), month).lengthOfMonth();
    }

    static boolean validInstant(String value) {
        return parse(value).isPresent();
    }

    /** Epoch millis of a valid instant (Z or hh:mm offset, 0 to 3 fraction digits), else empty. */
    static OptionalLong parse(String value) {
        if (value == null) {
            return OptionalLong.empty();
        }
        Matcher m = INSTANT.matcher(value);
        if (!m.matches() || !dayExists(m)) {
            return OptionalLong.empty();
        }
        int hour = Integer.parseInt(m.group(4));
        int minute = Integer.parseInt(m.group(5));
        int second = Integer.parseInt(m.group(6));
        if (hour >= 24 || minute >= 60 || second >= 60) {
            return OptionalLong.empty();
        }
        long offset = 0;
        if (m.group(8) != null) {
            int offsetHour = Integer.parseInt(m.group(9));
            int offsetMinute = Integer.parseInt(m.group(10));
            // Date.parse yields NaN for an offset beyond 23:59.
            if (offsetHour > 23 || offsetMinute > 59) {
                return OptionalLong.empty();
            }
            offset = (offsetHour * 3600L + offsetMinute * 60L) * ("-".equals(m.group(8)) ? -1 : 1);
        }
        long millis = 0;
        if (m.group(7) != null) {
            millis = Integer.parseInt((m.group(7) + "00").substring(0, 3));
        }
        long day = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)),
                Integer.parseInt(m.group(3))).toEpochDay();
        long seconds = day * 86400L + hour * 3600L + minute * 60L + second - offset;
        return OptionalLong.of(seconds * 1000L + millis);
    }

    /** JavaScript String.prototype.trim().length > 0. */
    static boolean text(String value) {
        if (value == null) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            if (!space(value.charAt(i))) {
                return true;
            }
        }
        return false;
    }

    private static boolean space(char c) {
        return (c >= 9 && c <= 13) || c == 0xFEFF || c == 0x2028 || c == 0x2029
                || Character.getType(c) == Character.SPACE_SEPARATOR;
    }
}
