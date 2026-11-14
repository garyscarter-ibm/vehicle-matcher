package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** A typed outcome. body is the contract object (status, code, reasons, value, contractVersion, policyVersion). */
public record PolicyResult(String status, String policyVersion, ObjectNode body) {

    public boolean ok() {
        return "ok".equals(status);
    }

    /** The value of an ok outcome; null otherwise. Always a copy owned by this result. */
    public JsonNode value() {
        return body.get("value");
    }

    /** The failure code, or null for an ok outcome. */
    public String code() {
        JsonNode code = body.get("code");
        return code == null || !code.isTextual() ? null : code.textValue();
    }
}
