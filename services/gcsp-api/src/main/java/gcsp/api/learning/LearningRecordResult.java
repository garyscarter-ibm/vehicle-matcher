package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** A typed outcome in the Node result shape: body carries status, contractVersion and either value or code and reason. */
public record LearningRecordResult(String status, ObjectNode body) {

    public static final String CONTRACT_VERSION = "1.0.0";

    public boolean ok() {
        return "ok".equals(status);
    }

    public JsonNode value() {
        return body.get("value");
    }

    public String code() {
        JsonNode code = body.get("code");
        return code == null ? null : code.textValue();
    }

    static LearningRecordResult ok(JsonNode value) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("status", "ok");
        body.set("value", value);
        body.put("contractVersion", CONTRACT_VERSION);
        return new LearningRecordResult("ok", body);
    }

    static LearningRecordResult failure(String status, String code, String reason, boolean retryable) {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("status", status).put("code", code).put("reason", reason).put("retryable", retryable);
        body.put("contractVersion", CONTRACT_VERSION);
        return new LearningRecordResult(status, body);
    }

    static LearningRecordResult unavailable(String code) {
        return failure("unavailable", code, "Learning records are unavailable.", true);
    }
}
