package gcsp.api.clock;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;

/** The template's London wall time moved to a wall instant's London date; named times shift by the same days. */
public final class ScenarioClockStart {

    /** A run's own start and named times. */
    public record Dated(Instant startsAt, Map<String, Instant> namedTimes) {}

    static final ZoneId LONDON = ZoneId.of("Europe/London");

    private ScenarioClockStart() {}

    public static Dated derive(Instant templateStart, Map<String, Instant> templateNamed, Instant wall) {
        LocalDate today = wall.atZone(LONDON).toLocalDate();
        long shift = ChronoUnit.DAYS.between(templateStart.atZone(LONDON).toLocalDate(), today);
        Map<String, Instant> named = new LinkedHashMap<>();
        templateNamed.forEach((name, at) -> named.put(name, onDay(at, at.atZone(LONDON).toLocalDate().plusDays(shift))));
        return new Dated(onDay(templateStart, today), named);
    }

    /** The template's London time of day on the given London date; an ambiguous autumn time takes the later one. */
    private static Instant onDay(Instant template, LocalDate day) {
        LocalTime time = template.atZone(LONDON).toLocalTime().truncatedTo(ChronoUnit.MINUTES);
        return day.atTime(time).atZone(LONDON).withLaterOffsetAtOverlap().toInstant();
    }
}
