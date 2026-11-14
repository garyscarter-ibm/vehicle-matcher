package gcsp.api.returns;

import java.time.Instant;

/** No policy file is configured: every read is unavailable. */
public final class UnconfiguredReturnPolicy implements ReturnPolicyPort {

    @Override
    public ReturnPolicyReading read(String runId, Instant asOf, String policyVersion) {
        return ReturnPolicyReading.unavailable();
    }
}
