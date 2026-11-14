package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** What a brief operation returns; the HTTP layer maps Ok to 200 and a Refusal to its httpStatus and body. */
public sealed interface BriefResult {

    /** replayed is true when the stored receipt of an earlier identical command was returned. */
    record Ok(JsonNode value, boolean replayed) implements BriefResult {
        public Ok(JsonNode value) {
            this(value, false);
        }
    }

    /** A typed non-success: status/code/reason/retryable plus optional extra fields merged into the body. */
    record Refusal(int httpStatus, String status, String code, String reason, boolean retryable, JsonNode extra)
            implements BriefResult {

        public ObjectNode body() {
            ObjectNode n = Json.obj();
            n.put("status", status).put("code", code).put("reason", reason).put("retryable", retryable);
            if (extra != null && extra.isObject()) extra.properties().forEach(e -> n.set(e.getKey(), e.getValue()));
            return n;
        }

        static Refusal invalid(String code, String reason, ObjectNode extra) {
            return new Refusal(400, "invalid", code, reason, false, extra);
        }

        /** One field reason, the usual invalid shape. */
        static Refusal invalid(String code, String field, String reason) {
            ObjectNode extra = Json.obj();
            extra.putArray("reasons").addObject().put("field", field).put("reason", reason);
            return invalid(code, reason, extra);
        }

        static Refusal staleVersion(String resource, long expected, long current) {
            ObjectNode extra = Json.obj();
            extra.put("expectedVersion", expected).put("currentVersion", current).put("action", "refresh");
            extra.putObject("resource").put("table", "draft".equals(resource) ? "brief-draft" : "briefs");
            return new Refusal(409, "stale-version", "stale-version", "The " + resource
                    + " changed since it was read. Refresh and try again.", false, extra);
        }

        static Refusal conflict(String code, String reason, ObjectNode extra) {
            return new Refusal(409, "conflict", code, reason, false, extra);
        }

        static Refusal notFound(String resourceType) {
            ObjectNode extra = Json.obj().put("resourceType", resourceType);
            return new Refusal(404, "not-found", "not-found", "No " + resourceType + " exists yet.", false, extra);
        }

        static Refusal unavailable() {
            return new Refusal(503, "unavailable", "brief-unavailable", "The brief service is unavailable.", true, null);
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
