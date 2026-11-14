package gcsp.api.notify;

import java.time.Instant;

/** No policy is bound: delivery rules are unavailable, so nothing is claimed. */
public final class UnconfiguredDeliveryRules implements DeliveryRules {

    @Override
    public Result read(String runId, Instant asOf) {
        return new Unavailable();
    }
}
