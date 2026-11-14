package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of an ordering operation; slice 2 maps Ok to 200, Pending to 202, Refused to 4xx, Unavailable to 503. */
public sealed interface OrderingResult {

    /** value is the projection, or the terms. replayed means an earlier identical submit already existed. */
    record Ok(JsonNode value, boolean replayed) implements OrderingResult {}

    /** The handoff is not settled; value is the pending projection when it could be read. */
    record Pending(String operationId, JsonNode value) implements OrderingResult {}

    /** status is the HTTP family: 400 invalid, 403 forbidden, 404 not-found, 409 conflict. field names an invalid field. */
    record Refused(String code, int status, String field) implements OrderingResult {}

    /** Retryable (503): policy, provider or database not available. */
    record Unavailable(String code) implements OrderingResult {}
}
