package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** What a case operation returns; the HTTP layer maps Ok to 200 and a Refusal to its httpStatus and body. */
public sealed interface CaseResult {

    /** replayed is true when the stored receipt of an earlier identical command was returned. */
    record Ok(JsonNode value, boolean replayed) implements CaseResult {
        public Ok(JsonNode value) {
            this(value, false);
        }
    }

    /** A typed non-success: status/code/reason/retryable plus optional extra fields merged into the body. */
    record Refusal(int httpStatus, String status, String code, String reason, boolean retryable, JsonNode extra)
            implements CaseResult {

        public ObjectNode body() {
            ObjectNode n = CaseJson.obj();
            n.put("status", status).put("code", code).put("reason", reason).put("retryable", retryable);
            if (extra != null && extra.isObject()) extra.properties().forEach(e -> n.set(e.getKey(), e.getValue()));
            return n;
        }

        /** One field reason, the usual invalid shape. */
        static Refusal invalid(String code, String field, String reason) {
            ObjectNode extra = CaseJson.obj();
            extra.putArray("reasons").addObject().put("field", field).put("reason", reason);
            extra.put("action", "review-and-retry");
            return new Refusal(400, "invalid", code, reason, false, extra);
        }

        static Refusal invalid(String field, String reason) {
            return invalid("invalid-case-command", field, reason);
        }

        static Refusal forbidden(String code, String reason) {
            return new Refusal(403, "forbidden", code, reason, false, null);
        }

        static Refusal notFound(String reason) {
            return new Refusal(404, "not-found", "not-found", reason, false, null);
        }

        static Refusal staleVersion(long expected, long current) {
            ObjectNode extra = CaseJson.obj();
            extra.put("expectedVersion", expected).put("currentVersion", current).put("action", "refresh");
            return new Refusal(409, "stale-version", "stale-version",
                    "The case changed since it was read. Refresh and try again.", false, extra);
        }

        static Refusal conflict(String code, String reason) {
            return new Refusal(409, "conflict", code, reason, false, null);
        }

        static Refusal unavailable() {
            return new Refusal(503, "unavailable", "case-unavailable",
                    "Renewal case policy or context is unavailable. Ask the scheme team to check the scheme setup.", true, null);
        }
    }

    /** Carries a refusal out of a command's work callback so the transaction rolls back. */
    final class Refused extends RuntimeException {
        private final transient Refusal refusal;

        Refused(Refusal refusal) {
            super(refusal.code(), null, false, false);
            this.refusal = refusal;
        }

        Refusal refusal() {
            return refusal;
        }
    }
}
