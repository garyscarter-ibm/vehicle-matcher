package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;

/** What a tick handler reports: done, handed to an external operation, or failed (the tick is interrupted). */
public sealed interface HandlerOutcome {

    record Ok(JsonNode value) implements HandlerOutcome {
        public Ok {
            if (value == null) value = NullNode.instance;
        }
    }

    /** All three fields must be nonblank, else the clock treats the outcome as invalid. */
    record Pending(String operationId, String operationType, String lastKnownState) implements HandlerOutcome {}

    record Failed(String status, String code, boolean retryable) implements HandlerOutcome {}
}
