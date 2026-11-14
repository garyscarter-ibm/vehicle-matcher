package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The typed answer of a manual-claims command or read. Pending means inspect by operation id, never resubmit blindly. */
public sealed interface ClaimResult {

    String code();

    boolean retryable();

    /** The Node-shaped view {state, editable, supportOwner, action} that every answer carries for the screen. */
    JsonNode view();

    static ObjectNode viewOf(String state, String action) {
        ObjectNode v = JsonNodeFactory.instance.objectNode();
        v.put("state", state);
        v.put("editable", false);
        v.put("supportOwner", "employee");
        v.put("action", action);
        return v;
    }

    record Ok(JsonNode value, boolean replayed) implements ClaimResult {
        public String code() {
            return replayed ? "replayed" : "ok";
        }

        public boolean retryable() {
            return false;
        }

        public JsonNode view() {
            return value.path("view");
        }
    }

    /** field names the offending input field. */
    record Invalid(String field, String reason) implements ClaimResult {
        public String code() {
            return "invalid-manual-claim";
        }

        public boolean retryable() {
            return false;
        }

        public JsonNode view() {
            return viewOf("validation", "correct-fields");
        }
    }

    /** noClaim is the Node view {no-claim, browse-stock} when the employee simply has no claim yet. */
    record NotFound(String reason, boolean noClaim) implements ClaimResult {
        public String code() {
            return "not-found";
        }

        public boolean retryable() {
            return false;
        }

        public JsonNode view() {
            return noClaim ? viewOf("no-claim", "browse-stock") : viewOf("not-found", "browse-stock");
        }
    }

    record Forbidden(String reason) implements ClaimResult {
        public String code() {
            return "forbidden";
        }

        public boolean retryable() {
            return false;
        }

        public JsonNode view() {
            return viewOf("forbidden", "browse-stock");
        }
    }

    /** extra carries the Node detail: resource, expectedVersion and currentVersion for stale-version, offerId for offer-held. */
    record Conflict(String code, String message, JsonNode extra) implements ClaimResult {
        public boolean retryable() {
            return "stale-version".equals(code);
        }

        public JsonNode view() {
            String action = switch (code) {
                case "release-required" -> "release-before-change";
                case "offer-held" -> "view-offer";
                default -> "refresh-review";
            };
            return viewOf("conflict", action);
        }
    }

    /** The commit outcome is unknown (uncertain) or the work is still running; check the operation before any resubmit. */
    record Pending(String operationId, boolean uncertain) implements ClaimResult {
        public String code() {
            return uncertain ? "outcome-uncertain" : "pending";
        }

        public boolean retryable() {
            return false;
        }

        public JsonNode view() {
            return viewOf("pending", "check-status");
        }
    }

    record Unavailable(String code, boolean retryable) implements ClaimResult {
        public JsonNode view() {
            return viewOf("unavailable", "retry");
        }
    }
}
