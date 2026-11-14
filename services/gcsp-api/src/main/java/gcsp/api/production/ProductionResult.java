package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of a Production command; the HTTP slice maps it. Uncertain means retry with the same command id. */
public sealed interface ProductionResult {

    record Ok(JsonNode value, boolean replayed) implements ProductionResult {}

    /** Some line is still uncertain; the caller retries with the same command to continue without duplicates. */
    record Pending(JsonNode value) implements ProductionResult {}

    record Invalid(String code, String reason) implements ProductionResult {}

    record Conflict(String code, String reason, boolean retryable, JsonNode details) implements ProductionResult {}

    record Unavailable(String code, String reason, boolean retryable) implements ProductionResult {}

    record Uncertain(String operationId) implements ProductionResult {}
}
