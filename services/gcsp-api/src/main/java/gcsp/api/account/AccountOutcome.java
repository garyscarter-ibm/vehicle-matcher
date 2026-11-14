package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * ok carries the projection in {@code value}; a refusal carries Node's refusal body in {@code refusal}.
 * Node's contractVersion field is omitted: the Java contract envelope is {status, value}.
 */
public record AccountOutcome(String status, JsonNode value, JsonNode refusal) {

    public static AccountOutcome ok(JsonNode value) {
        return new AccountOutcome("ok", value, null);
    }

    public static AccountOutcome unavailable(String source) {
        JsonNodeFactory f = JsonNodeFactory.instance;
        ObjectNode view = f.objectNode().put("state", "unavailable").put("editable", false)
                .put("supportOwner", "scheme-support").put("action", "retry");
        ObjectNode body = f.objectNode().put("status", "unavailable").put("code", "manual-source-unavailable")
                .put("source", source).put("retryable", true)
                .put("reason", "This source is unavailable. Your saved choices have been retained.");
        body.set("view", view);
        return new AccountOutcome("unavailable", null, body);
    }

    public boolean isOk() {
        return "ok".equals(status);
    }
}
