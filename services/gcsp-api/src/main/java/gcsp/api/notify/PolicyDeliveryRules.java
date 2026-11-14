package gcsp.api.notify;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.time.Instant;

/** Reads {@code notify.delivery.v1} through the canonical PolicyService; any failure is Unavailable. */
public final class PolicyDeliveryRules implements DeliveryRules {

    static final String KEY = "notify.delivery.v1";

    private final PolicyService policy;

    public PolicyDeliveryRules(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public Result read(String runId, Instant asOf) {
        try {
            PolicyResult found = policy.getAssumption(KEY, new PolicyRead(runId, PolicyClock.iso(asOf), null));
            JsonNode v = found.ok() ? found.value().path("value") : null;
            if (v == null || !whole(v, "maxAttempts") || !whole(v, "retryBaseSeconds")
                    || !whole(v, "retryMaximumSeconds")) {
                return new Unavailable();
            }
            Rules rules = new Rules(found.policyVersion(), v.get("maxAttempts").asLong(),
                    v.get("retryBaseSeconds").asLong(), v.get("retryMaximumSeconds").asLong());
            return rules.valid() ? rules : new Unavailable();
        } catch (RuntimeException e) {
            return new Unavailable();
        }
    }

    private static boolean whole(JsonNode value, String field) {
        JsonNode n = value.get(field);
        return n != null && n.isIntegralNumber() && n.canConvertToLong();
    }
}
