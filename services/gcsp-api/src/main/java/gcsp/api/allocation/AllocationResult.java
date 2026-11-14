package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of one trigger allocation. */
public sealed interface AllocationResult {

    /** Finished: the stored outcome. Replayed means it had already completed before this call. */
    record Completed(String allocationId, JsonNode outcome, boolean replayed) implements AllocationResult {}

    /** An outcome was uncertain or the database was unavailable; calling allocate again resumes it. */
    record Pending(String code, String operationId, boolean retryable) implements AllocationResult {}

    /** The trigger, policy or candidates cannot be used, or the trigger id was reused with different input. */
    record Refused(String code, String message) implements AllocationResult {}
}
