package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;

/** What a command's work callback returns: its result, or a typed refusal that rolls everything back. */
public sealed interface WorkResult {

    record Ok(JsonNode result) implements WorkResult {}

    record Refuse(String code, String message) implements WorkResult {}

    static WorkResult ok(JsonNode result) {
        return new Ok(result);
    }

    static WorkResult refuse(String code, String message) {
        return new Refuse(code, message);
    }
}
