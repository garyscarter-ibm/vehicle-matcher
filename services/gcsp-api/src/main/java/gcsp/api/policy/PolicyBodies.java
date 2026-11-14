package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Contract bodies shared by publication and activation, matching the Node policy outcomes. */
final class PolicyBodies {

    static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    static final String FORBIDDEN_REASON = "This person cannot perform that action.";
    static final String STALE_RUN_REASON = "This page is out of date. Reload to see the latest.";

    private PolicyBodies() {
    }

    static ObjectNode fields() {
        return JSON.objectNode();
    }

    static PolicyResult result(String status, String policyVersion, ObjectNode fields) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.setAll(fields);
        body.put("contractVersion", PolicyService.CONTRACT_VERSION);
        if (policyVersion == null) {
            body.putNull("policyVersion");
        } else {
            body.put("policyVersion", policyVersion);
        }
        return new PolicyResult(status, policyVersion, body);
    }

    static PolicyResult invalid(String field, String reason) {
        ObjectNode f = fields();
        f.put("code", "invalid-policy-change");
        f.put("accepted", false);
        f.putArray("reasons").addObject().put("field", field).put("reason", reason);
        return result("invalid", null, f);
    }

    static PolicyResult unavailable() {
        ObjectNode f = fields();
        f.put("accepted", false);
        f.put("reason", "The policy source is unavailable.");
        f.put("retryable", true);
        return result("unavailable", null, f);
    }

    /** A null code is the plain role refusal, whose body is exactly the Node one. */
    static PolicyResult forbidden(String code) {
        ObjectNode f = fields();
        if (code != null) {
            f.put("code", code);
        }
        f.put("reason", FORBIDDEN_REASON);
        f.put("accepted", false);
        return result("forbidden", null, f);
    }

    static PolicyResult stale(String expected, String current) {
        ObjectNode f = fields();
        f.put("accepted", false);
        f.put("expectedVersion", expected);
        if (current == null) {
            f.putNull("currentVersion");
        } else {
            f.put("currentVersion", current);
        }
        f.put("action", "refresh");
        return result("stale-version", current, f);
    }

    static PolicyResult conflict(String code, String reason, boolean retryable) {
        ObjectNode f = fields();
        f.put("code", code);
        f.put("accepted", false);
        f.put("reason", reason);
        f.put("retryable", retryable);
        return result("conflict", null, f);
    }

    static PolicyResult uncertain(String operationId) {
        ObjectNode f = fields();
        f.put("code", "outcome-uncertain");
        f.put("operationId", operationId);
        f.put("reason", "The change may or may not have been saved. Check before trying again.");
        f.put("retryable", false);
        return result("uncertain", null, f);
    }

    static PolicyResult sourceFailure(PolicySourceException error) {
        boolean invalid = PolicySourceException.INVALID.equals(error.code());
        ObjectNode f = fields();
        f.put("code", error.code());
        f.put("accepted", false);
        if (!invalid) {
            f.put("reason", "The policy source is unavailable.");
            f.put("retryable", true);
        }
        f.putArray("reasons").addObject().put("field", "source")
                .put("reason", "The policy source could not be loaded and validated.");
        return result(invalid ? "invalid" : "unavailable", null, f);
    }

    static PolicyResult accepted(String policyVersion, String effectiveFrom, String publisher, String publishedAt,
            JsonNode adoption) {
        ObjectNode f = fields();
        ObjectNode value = f.putObject("value");
        value.put("accepted", true);
        value.put("policyVersion", policyVersion);
        value.put("effectiveFrom", effectiveFrom);
        value.put("publisher", publisher);
        value.put("publishedAt", publishedAt);
        if (adoption != null && !adoption.isNull()) {
            value.set("adoption", adoption.deepCopy());
        }
        return result("ok", policyVersion, f);
    }
}
