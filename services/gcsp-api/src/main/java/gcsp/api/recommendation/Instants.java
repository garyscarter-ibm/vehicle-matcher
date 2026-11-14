package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Date.parse, toISOString and the vehicles `date` check as the Node recommendation code uses them. */
final class Instants {

    private static final Pattern PARSE = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:\\d{2})?)?");
    private static final Pattern STRICT = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d{3})?Z");

    private Instants() {}

    /** Date.parse of ISO forms (a missing zone reads as UTC, the generator pins TZ=UTC); other forms and non-strings are NaN. */
    static double parse(JsonNode n) {
        return n != null && n.isTextual() ? parse(n.textValue()) : Double.NaN;
    }

    /** V8 accepts any day 1 to 31 and rolls it over, so a day beyond the month still parses. */
    static double parse(String s) {
        Matcher m = PARSE.matcher(s);
        if (!m.matches()) return Double.NaN;
        int month = Integer.parseInt(m.group(2));
        int day = Integer.parseInt(m.group(3));
        if (month < 1 || month > 12 || day < 1 || day > 31) return Double.NaN;
        long hour = 0;
        long minute = 0;
        long second = 0;
        long millis = 0;
        long offset = 0;
        if (m.group(4) != null) {
            hour = Long.parseLong(m.group(4));
            minute = Long.parseLong(m.group(5));
            second = m.group(6) == null ? 0 : Long.parseLong(m.group(6));
            if (m.group(7) != null) millis = Long.parseLong((m.group(7) + "00").substring(0, 3));
            if (hour > 24 || minute > 59 || second > 59 || hour == 24 && (minute | second | millis) != 0) return Double.NaN;
            String zone = m.group(8);
            if (zone != null && !zone.equals("Z")) {
                long oh = Long.parseLong(zone.substring(1, 3));
                long om = Long.parseLong(zone.substring(4, 6));
                if (oh > 23 || om > 59) return Double.NaN;
                offset = (oh * 60 + om) * 60_000L * (zone.charAt(0) == '-' ? -1 : 1);
            }
        }
        long days = LocalDate.of(Integer.parseInt(m.group(1)), month, 1).toEpochDay() + day - 1;
        return days * 86_400_000d + ((hour * 60 + minute) * 60 + second) * 1000d + millis - offset;
    }

    /** new Date(ms).toISOString(); the time value is truncated and out of range throws like a RangeError. */
    static String iso(double ms) {
        if (!Double.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new RecommendationFault("Invalid time value");
        ZonedDateTime z = Instant.ofEpochMilli((long) ms).atZone(ZoneOffset.UTC);
        int year = z.getYear();
        String y = year >= 0 && year <= 9999 ? String.format("%04d", year) : (year < 0 ? "-" : "+") + String.format("%06d", Math.abs(year));
        return String.format("%s-%02d-%02dT%02d:%02d:%02d.%03dZ", y, z.getMonthValue(), z.getDayOfMonth(), z.getHour(),
                z.getMinute(), z.getSecond(), z.getNano() / 1_000_000);
    }

    /** The vehicles `date` rule: Z with 0 or exactly 3 fraction digits and a real calendar instant. */
    static boolean strictDate(JsonNode n) {
        if (n == null || !n.isTextual()) return false;
        Matcher m = STRICT.matcher(n.textValue());
        if (!m.matches()) return false;
        if (Integer.parseInt(m.group(4)) >= 24 || Integer.parseInt(m.group(5)) >= 60 || Integer.parseInt(m.group(6)) >= 60) return false;
        try {
            LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            return true;
        } catch (DateTimeException e) {
            return false;
        }
    }
}
