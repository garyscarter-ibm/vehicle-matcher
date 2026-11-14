package gcsp.api.supply;

import java.time.Instant;
import java.util.List;

/** What a provider is told: the run, tick time, policy values and what is already released or queued. */
public record PullRequest(String runId, Instant asOf, String tickId, int releaseSize, int leadTimeDays,
        String policyVersion, List<Released> released, List<QueuedSupply> queuedSupply) {

    /** A tranche already released, with the cars it wrote. */
    public record Released(String trancheId, List<String> orderUuids) {}

    /** Confirmed supply queued for release from eligibleFrom. */
    public record QueuedSupply(String supplyId, Instant confirmedAt, Instant eligibleFrom, String sourceVersion,
            String policyVersion) {}
}
