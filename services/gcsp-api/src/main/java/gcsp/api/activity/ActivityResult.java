package gcsp.api.activity;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** The activity projection, or the retryable 503 refusal that stands in for it. */
record ActivityResult(ObjectNode value, String code, String reason) {

    static ActivityResult ok(ObjectNode value) {
        return new ActivityResult(value, null, null);
    }

    static ActivityResult unavailable(String code) {
        return new ActivityResult(null, code, "The activity projection is unavailable.");
    }
}
