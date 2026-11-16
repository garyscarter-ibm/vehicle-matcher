package gcsp.api.planning;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The instant rules of the Node planner: validInstant, Date.parse on valid instants and toISOString. */
final class JsTime {

    static final long DAY = 86_400_000L;
    /** The largest absolute time value a JS Date holds. */
    static final double MAX_TIME = 8.64e15;
    private static final Pattern INSTANT = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|([+-])(\\d{2}):(\\d{2}))");

    private JsTime() {
    }

    /** Epoch milliseconds of a valid instant, or null where Node's validInstant refuses it. */
    static Long parse(String value) {
        if (value == null) {
            return null;
        }
        Matcher m = INSTANT.matcher(value);
        if (!m.matches()) {
            return null;
        }
        int hour = Integer.parseInt(m.group(4));
        int minute = Integer.parseInt(m.group(5));
        int second = Integer.parseInt(m.group(6));
        if (hour >= 24 || minute >= 60 || second >= 60) {
            return null;
        }
        LocalDate date;
        try {
            date = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
        } catch (java.time.DateTimeException e) {
            return null;
        }
        long offset = 0;
        if (m.group(8) != null) {
            int oh = Integer.parseInt(m.group(9));
            int om = Integer.parseInt(m.group(10));
            if (oh > 23 || om > 59) {
                return null;
            }
            offset = (oh * 3_600_000L + om * 60_000L) * (m.group(8).equals("-") ? -1 : 1);
        }
        long ms = m.group(7) == null ? 0 : Long.parseLong((m.group(7) + "00").substring(0, 3));
        return date.toEpochDay() * DAY + hour * 3_600_000L + minute * 60_000L + second * 1000L + ms - offset;
    }

    /** Date#toISOString for a finite time value. */
    static String iso(long ms) {
        LocalDateTime t = LocalDateTime.ofEpochSecond(Math.floorDiv(ms, 1000L), 0, ZoneOffset.UTC);
        int year = t.getYear();
        String y = year >= 0 && year <= 9999 ? String.format("%04d", year)
                : (year < 0 ? "-" : "+") + String.format("%06d", Math.abs(year));
        return String.format("%s-%02d-%02dT%02d:%02d:%02d.%03dZ", y, t.getMonthValue(), t.getDayOfMonth(),
                t.getHour(), t.getMinute(), t.getSecond(), Math.floorMod(ms, 1000L));
    }

    private static final Pattern LENIENT = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3})\\d*)?)?(Z|[+-]\\d{2}:?\\d{2})?)?",
            Pattern.CASE_INSENSITIVE);

    /**
     * Date.parse as V8 reads the ISO forms the planner can meet before validation: a month day past the month
     * end rolls over, hour 24 is midnight, a missing zone is read as UTC. Other forms are NaN (not modelled).
     */
    static double lenient(String value) {
        Matcher m = value == null ? null : LENIENT.matcher(value);
        if (m == null || !m.matches()) {
            return Double.NaN;
        }
        int month = Integer.parseInt(m.group(2));
        int day = Integer.parseInt(m.group(3));
        int hour = m.group(4) == null ? 0 : Integer.parseInt(m.group(4));
        int minute = m.group(5) == null ? 0 : Integer.parseInt(m.group(5));
        int second = m.group(6) == null ? 0 : Integer.parseInt(m.group(6));
        long ms = m.group(7) == null ? 0 : Long.parseLong((m.group(7) + "00").substring(0, 3));
        if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 59
                || hour == 24 && (minute > 0 || second > 0 || ms > 0)) {
            return Double.NaN;
        }
        long offset = 0;
        String zone = m.group(8);
        if (zone != null && !zone.equalsIgnoreCase("Z")) {
            String digits = zone.substring(1).replace(":", "");
            int oh = Integer.parseInt(digits.substring(0, 2));
            int om = Integer.parseInt(digits.substring(2));
            if (oh > 23 || om > 59) {
                return Double.NaN;
            }
            offset = (oh * 3_600_000L + om * 60_000L) * (zone.charAt(0) == '-' ? -1 : 1);
        }
        long first = LocalDate.of(Integer.parseInt(m.group(1)), month, 1).toEpochDay();
        return (first + day - 1) * DAY + hour * 3_600_000L + minute * 60_000L + second * 1000L + ms - offset;
    }
}
