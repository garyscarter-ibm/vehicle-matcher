package gcsp.api.notify;

import java.time.Instant;

/** Port for the delivery policy ({@code notify.delivery.v1}); the canonical values live in policy, not here. */
public interface DeliveryRules {

    Result read(String runId, Instant asOf);

    sealed interface Result permits Rules, Unavailable {}

    record Rules(String policyVersion, long maxAttempts, long retryBaseSeconds, long retryMaximumSeconds)
            implements Result {

        private static final long SAFE_MAX = (1L << 53) - 1;

        /** Same checks as the Node dispatcher: safe integers, max >= 1, base >= 1, maximum >= base. */
        public boolean valid() {
            return maxAttempts >= 1 && maxAttempts <= SAFE_MAX && retryBaseSeconds >= 1 && retryBaseSeconds <= SAFE_MAX
                    && retryMaximumSeconds >= retryBaseSeconds && retryMaximumSeconds <= SAFE_MAX;
        }
    }

    record Unavailable() implements Result {}
}
