package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;

/** A provider's answer to a pull: the raw stock-list value (validated by the release engine), or a failure. */
public sealed interface ProviderResponse {

    record Ok(JsonNode value) implements ProviderResponse {}

    /** A failed pull; retryable by redelivering the tick. */
    record Unavailable(String code, String reason) implements ProviderResponse {}

    /** The provider's plan belongs to another run. */
    record StaleRun() implements ProviderResponse {}
}
