package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;

/** One lifecycle.stages.v1 read for an order, as the stage producer (FUCQ-470) answers it. */
public sealed interface StageRead {

    record Ok(JsonNode value) implements StageRead {}

    record NotFound() implements StageRead {}

    record Forbidden() implements StageRead {}

    record Unsupported() implements StageRead {}

    /** Any other producer status (unavailable, invalid, a throw); code is the producer's, when it gave one. */
    record Unavailable(String status, String code) implements StageRead {}
}
