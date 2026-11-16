package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountClockPort;
import gcsp.api.account.AccountScope;
import gcsp.api.claims.ClaimClock;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.recommendation.RecommendationClock;
import gcsp.api.recommendation.RecommendationContext;
import java.time.Instant;

/** The replay's virtual "now": one forward-only instant that every Java port asks for. Single thread. */
final class ReplayClock implements ClaimClock, AccountClockPort, RecommendationClock {

    private Instant now;
    private long version = 1;

    ReplayClock(Instant start) {
        this.now = start;
    }

    Instant now() {
        return now;
    }

    /** Forward only; a move back is an event-order refusal. */
    void advanceTo(Instant to) {
        if (to.isBefore(now)) throw new ComparisonRunError("invalid-input", "event-order");
        if (to.isAfter(now)) {
            now = to;
            version++;
        }
    }

    @Override
    public Instant now(RunContext context) {
        return now;
    }

    @Override
    public ClockReading now(AccountScope scope) {
        return new ClockReading(PolicyClock.iso(now), "comparison-clock:" + version);
    }

    @Override
    public JsonNode now(RecommendationContext context) {
        JsonNodeFactory f = JsonNodeFactory.instance;
        ObjectNode value = f.objectNode();
        value.put("now", PolicyClock.iso(now));
        value.put("runId", context.runId());
        value.put("clockVersion", "comparison-clock:" + version);
        ObjectNode out = f.objectNode();
        out.put("status", "ok");
        out.set("value", value);
        out.put("contractVersion", "1.0.0");
        return out;
    }
}
