package gcsp.api.scenario;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.clock.ScenarioClockStart;
import gcsp.api.policy.PolicySourceException;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** FUCQ-528: Sam's fixed renewal is orderable only for a window of run dates; fail loudly when today leaves it. */
class DemoOrderWindowGuardTest {

    private static final long DAY_MS = 86_400_000L;
    private static final ZoneId LONDON = ZoneId.of("Europe/London");

    private static long horizonDays;
    private static long leadDays;
    private static Instant template;
    private static Instant renewal;
    private static Instant requiredBy;

    @BeforeAll
    static void load() throws PolicySourceException {
        JsonNode policy = new RetainedFilePolicySource().loadVersions("guard").get(0).get("assumptions");
        horizonDays = assumption(policy, "orderPlan.horizonDays").asLong();
        leadDays = assumption(policy, "supply.leadTimeDays").asLong();
        template = Instant.parse(assumption(policy, "clock.scenario.v1").get("startsAt").textValue());
        JsonNode sam = DemoPreparationFile.load().principals().stream()
                .filter(p -> "employee-sam".equals(p.get("employeeId").textValue())).findFirst().orElseThrow();
        renewal = Instant.parse(sam.at("/record/contracts/0/contractEndDate").textValue() + "T23:59:59.999Z");
        requiredBy = Instant.parse(sam.at("/record/employeeFacts/requiredBy/value").textValue());
    }

    @Test
    void samsRenewalIsOrderableOnTodaysRunDate() {
        Optional<String> problem = problem(LocalDate.now(LONDON));
        assertTrue(problem.isEmpty(), problem.orElse(""));
    }

    @Test
    void theGuardComputesTheGeneratorsWindowAndRefusesDaysOutsideIt() {
        LocalDate[] window = window(LocalDate.of(2026, 12, 1));
        assertEquals(LocalDate.of(2026, 11, 17), window[0], "update generate.mjs's comment and this test with the dates");
        assertEquals(LocalDate.of(2027, 1, 19), window[1], "update generate.mjs's comment and this test with the dates");
        assertTrue(problem(window[0]).isEmpty());
        assertTrue(problem(window[1]).isEmpty());
        for (LocalDate outside : new LocalDate[] {window[0].minusDays(1), window[1].plusDays(1)}) {
            String message = problem(outside).orElseThrow();
            assertTrue(message.contains("orderable only for run dates 2026-11-17 to 2027-01-19"), message);
            assertTrue(message.contains("Regenerate the demo dates"), message);
        }
    }

    private static Optional<String> problem(LocalDate day) {
        if (orderable(day)) {
            return Optional.empty();
        }
        LocalDate[] window = window(day);
        return Optional.of("Sam's renewal " + renewal + " is orderable only for run dates " + window[0] + " to "
                + window[1] + " (horizon " + horizonDays + " days, lead time " + leadDays + " days); the run date is "
                + day + ". Regenerate the demo dates: change the day offset in tools/scenario-baseline/generate.mjs"
                + " and rerun it.");
    }

    private static LocalDate[] window(LocalDate around) {
        LocalDate first = null;
        LocalDate last = null;
        for (LocalDate d = around.minusYears(1); d.isBefore(around.plusYears(2)); d = d.plusDays(1)) {
            if (orderable(d)) {
                first = first == null ? d : first;
                last = d;
            }
        }
        return new LocalDate[] {first, last};
    }

    /** The planner's rules: renewal within asOf + horizon (PlanInput, DemandCohort), asOf + lead by required-by (OrderPlanSolver). */
    private static boolean orderable(LocalDate day) {
        long asOf = ScenarioClockStart.derive(template, Map.of(), day.atTime(12, 0).atZone(LONDON).toInstant())
                .startsAt().toEpochMilli();
        return renewal.toEpochMilli() <= asOf + horizonDays * DAY_MS
                && asOf + leadDays * DAY_MS <= requiredBy.toEpochMilli();
    }

    private static JsonNode assumption(JsonNode assumptions, String key) {
        for (JsonNode a : assumptions) {
            if (key.equals(a.path("key").asText())) {
                return a.get("value");
            }
        }
        throw new IllegalStateException("Policy has no " + key);
    }
}
