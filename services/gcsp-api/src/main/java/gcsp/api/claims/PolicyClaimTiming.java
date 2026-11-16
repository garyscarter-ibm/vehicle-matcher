package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.time.Instant;

/** Claim timing from the canonical PolicyService at the employee's pinned version; nothing is defaulted. */
public final class PolicyClaimTiming implements ClaimTimingPort {

    static final String PREVIEW = "hold.cart.durationSeconds";
    static final String REVIEW = "hold.cart.orderReview.durationSeconds";
    static final String TRANSITION = "hold.cart.orderReview.transition";
    static final String UNAVAILABLE = "claim-timing-unavailable";

    private final PolicyService policy;

    public PolicyClaimTiming(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public Timing timing(ClaimScope scope, Instant now) {
        String version = scope.policyVersion();
        if (scope.runId() == null || scope.runId().isBlank() || version == null || version.isBlank()) {
            return new Unavailable(UNAVAILABLE);
        }
        try {
            ArrayNode rows = JsonNodeFactory.instance.arrayNode();
            JsonNode[] values = new JsonNode[3];
            String[] keys = {PREVIEW, REVIEW, TRANSITION};
            for (int i = 0; i < keys.length; i++) {
                PolicyResult r = policy.getAssumption(keys[i], new PolicyRead(scope.runId(), PolicyClock.iso(now), version));
                JsonNode row = r.value();
                if (!r.ok() || !version.equals(r.policyVersion()) || row == null || !row.isObject()) {
                    return new Unavailable(UNAVAILABLE);
                }
                values[i] = row.get("value");
                rows.add(row);
            }
            if (!positive(values[0]) || !positive(values[1]) || values[2] == null || !values[2].isTextual()
                    || !"once-from-preview".equals(values[2].textValue())) {
                return new Unavailable(UNAVAILABLE);
            }
            return new Known(values[0].longValue(), values[1].longValue(), rows);
        } catch (RuntimeException e) {
            return new Unavailable(UNAVAILABLE);
        }
    }

    private static boolean positive(JsonNode v) {
        return v != null && v.isIntegralNumber() && v.canConvertToLong() && v.longValue() > 0;
    }
}
