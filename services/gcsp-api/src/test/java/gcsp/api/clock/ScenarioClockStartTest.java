package gcsp.api.clock;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ScenarioClockStartTest {

    private static Map<String, Instant> named(String release, String expiry) {
        Map<String, Instant> m = new LinkedHashMap<>();
        m.put("release", Instant.parse(release));
        m.put("expiry", Instant.parse(expiry));
        return m;
    }

    @Test
    void movesTemplateWallTimeToTheWallInstantsLondonDate() {
        var dated = ScenarioClockStart.derive(Instant.parse("2026-11-05T09:00:00Z"),
                named("2026-11-05T09:30:00Z", "2026-11-05T11:00:00Z"), Instant.parse("2026-11-14T22:00:00Z"));
        assertEquals(Instant.parse("2026-11-14T09:00:00Z"), dated.startsAt());
        assertEquals(Instant.parse("2026-11-14T09:30:00Z"), dated.namedTimes().get("release"));
        assertEquals(Instant.parse("2026-11-14T11:00:00Z"), dated.namedTimes().get("expiry"));
    }

    @Test
    void keepsLondonWallTimeAcrossTheBritishSummerTimeBoundary() {
        // Template in GMT, run date in BST: 09:00 London is 08:00 UTC in July.
        var dated = ScenarioClockStart.derive(Instant.parse("2026-11-05T09:00:00Z"),
                named("2026-11-05T09:30:00Z", "2026-11-05T11:00:00Z"), Instant.parse("2027-07-01T12:00:00Z"));
        assertEquals(Instant.parse("2027-07-01T08:00:00Z"), dated.startsAt());
        assertEquals(Instant.parse("2027-07-01T08:30:00Z"), dated.namedTimes().get("release"));
        assertEquals(Instant.parse("2027-07-01T10:00:00Z"), dated.namedTimes().get("expiry"));
    }

    @Test
    void usesTheLondonDateNotTheUtcDateNearMidnight() {
        // 23:30 UTC on 30 June is already 1 July in London (BST).
        var dated = ScenarioClockStart.derive(Instant.parse("2026-11-05T09:00:00Z"),
                named("2026-11-05T09:30:00Z", "2026-11-05T11:00:00Z"), Instant.parse("2027-06-30T23:30:00Z"));
        assertEquals(Instant.parse("2027-07-01T08:00:00Z"), dated.startsAt());
    }

    @Test
    void namedTimeOnALaterTemplateDayShiftsByTheSameDays() {
        var dated = ScenarioClockStart.derive(Instant.parse("2026-11-05T09:00:00Z"),
                named("2026-11-06T09:30:00Z", "2026-11-05T11:00:00Z"), Instant.parse("2026-11-14T10:00:00Z"));
        assertEquals(Instant.parse("2026-11-15T09:30:00Z"), dated.namedTimes().get("release"));
    }

    @Test
    void anAutumnShiftBackKeepsTheWallTime() {
        // 25 October 2026 is the day the clocks go back; 09:00 London is 09:00 UTC after the change.
        var dated = ScenarioClockStart.derive(Instant.parse("2026-07-05T08:00:00Z"),
                named("2026-07-05T08:30:00Z", "2026-07-05T10:00:00Z"), Instant.parse("2026-10-26T12:00:00Z"));
        assertEquals(Instant.parse("2026-10-26T09:00:00Z"), dated.startsAt());
        assertEquals(Instant.parse("2026-10-26T11:00:00Z"), dated.namedTimes().get("expiry"));
    }
}
