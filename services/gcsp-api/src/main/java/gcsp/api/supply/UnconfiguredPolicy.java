package gcsp.api.supply;

import java.time.Instant;

/** No policy source is wired yet: every read is unavailable, so nothing is released on a local default. */
public final class UnconfiguredPolicy implements ReleasePolicy {

    @Override
    public PolicyReading read(String runId, Instant asOf) {
        return new PolicyReading.Unavailable("The release policy is not configured.");
    }
}
