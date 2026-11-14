package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.AccountClockPort;
import gcsp.api.account.AccountScope;
import gcsp.api.persistence.EnvironmentGuard;
import java.util.function.Supplier;

/** The recommendation clock over the account clock: its instant for the caller's run, or stale-run when the run is not current. */
public final class AccountClockRecommendationClock implements RecommendationClock {

    private final AccountClockPort clock;
    private final Supplier<EnvironmentGuard.RunState> currentRun;

    public AccountClockRecommendationClock(AccountClockPort clock, Supplier<EnvironmentGuard.RunState> currentRun) {
        this.clock = clock;
        this.currentRun = currentRun;
    }

    /** Node's stale-run clock outcome when the caller's run is no longer the active one; null while it is current. */
    public JsonNode staleRun(String environmentId, String runId) {
        try {
            EnvironmentGuard.RunState run = currentRun.get();
            if (run.environmentId().equals(environmentId) && run.runId().equals(runId)) return null;
            return Outcomes.result("stale-run", new Js.B().s("reason", "This page is out of date. Reload to see the latest.").build());
        } catch (RuntimeException e) {
            return Outcomes.result("unavailable", new Js.B().s("reason", "The clock is unavailable.").s("retryable", true).build());
        }
    }

    @Override
    public JsonNode now(RecommendationContext context) {
        AccountClockPort.ClockReading reading;
        try {
            JsonNode stale = staleRun(context.environmentId(), context.runId());
            if (stale != null) return stale;
            reading = clock.now(new AccountScope(context.environmentId(), context.runId(), context.employeeId(), null,
                    context.roles(), null, null, null, null, context.policyVersion()));
        } catch (RuntimeException e) {
            return Outcomes.result("unavailable", new Js.B().s("reason", "The clock is unavailable.").s("retryable", true).build());
        }
        return new Js.B().s("status", "ok").s("value", new Js.B().s("now", reading.now()).s("runId", context.runId())
                .s("clockVersion", reading.clockVersion()).build()).s("contractVersion", Outcomes.CONTRACT_VERSION).build();
    }
}
