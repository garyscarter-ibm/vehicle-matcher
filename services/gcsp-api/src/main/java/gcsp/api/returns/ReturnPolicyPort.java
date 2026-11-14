package gcsp.api.returns;

import java.time.Instant;

/** Where return rules come from; the canonical PolicyService (FUCQ-457) can replace the retained-file reader. */
public interface ReturnPolicyPort {

    /** Rows of exactly {@code policyVersion} that are effective at {@code asOf}; anything else is unavailable. */
    ReturnPolicyReading read(String runId, Instant asOf, String policyVersion);
}
