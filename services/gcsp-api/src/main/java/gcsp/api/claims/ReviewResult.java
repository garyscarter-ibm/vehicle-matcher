package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** A review-details answer: a Node-shaped body with its status, or a claim answer passed through unchanged. */
public sealed interface ReviewResult {

    JsonNodeFactory F = JsonNodeFactory.instance;

    String status();

    String code();

    record Body(String status, ObjectNode body) implements ReviewResult {
        public String code() {
            return body.path("code").asText(null);
        }
    }

    record Claim(ClaimResult result) implements ReviewResult {
        public String status() {
            if (result instanceof ClaimResult.Ok) return "ok";
            if (result instanceof ClaimResult.Pending) return "pending";
            if (result instanceof ClaimResult.Invalid) return "invalid";
            if (result instanceof ClaimResult.Forbidden) return "forbidden";
            if (result instanceof ClaimResult.NotFound) return "not-found";
            if (result instanceof ClaimResult.Conflict) return "conflict";
            return "unavailable";
        }

        public String code() {
            return result.code();
        }
    }

    default boolean isOk() {
        return "ok".equals(status());
    }

    /** The value of an ok body; null for anything else. */
    default JsonNode value() {
        return this instanceof Body b && isOk() ? b.body().get("value") : null;
    }

    static ObjectNode view(String state, boolean editable, String action, String owner) {
        ObjectNode v = F.objectNode();
        v.put("state", state).put("editable", editable).put("action", action).put("supportOwner", owner);
        return v;
    }

    static ReviewResult of(String status, ObjectNode body) {
        ObjectNode ordered = F.objectNode();
        ordered.put("status", status);
        body.fieldNames().forEachRemaining(n -> {
            if (!n.equals("status")) ordered.set(n, body.get(n));
        });
        return new Body(status, ordered);
    }

    static ReviewResult ok(JsonNode value) {
        ObjectNode b = F.objectNode();
        b.set("value", value);
        return of("ok", b);
    }

    static ReviewResult invalid(String field, String reason) {
        ObjectNode b = F.objectNode().put("code", "invalid-review-details");
        b.putArray("reasons").addObject().put("field", field).put("reason", reason);
        b.set("view", view("validation", true, "correct-fields", "employee"));
        return of("invalid", b);
    }

    static ReviewResult unavailable(String source) {
        ObjectNode b = F.objectNode().put("code", "manual-review-source-unavailable").put("source", source)
                .put("retryable", true).put("reason", "Review details are unavailable. Saved inputs have been retained.");
        b.set("view", view("unavailable", false, "retry", "scheme-support"));
        return of("unavailable", b);
    }

    static ReviewResult conflict(String code) {
        ObjectNode b = F.objectNode().put("code", code).put("reason", code).put("action", "refresh");
        b.set("view", view("conflict", false, "refresh-review", "employee"));
        return of("conflict", b);
    }

    static ReviewResult stale(String resource, long expected, long current) {
        ObjectNode b = F.objectNode().put("code", "stale-review-details").put("resource", resource)
                .put("expectedVersion", expected).put("currentVersion", current).put("action", "refresh");
        b.set("view", view("conflict", false, "refresh-review", "employee"));
        return of("stale-version", b);
    }

    static ReviewResult forbidden(String reason) {
        return of("forbidden", F.objectNode().put("reason", reason));
    }

    static ReviewResult notFound(String resourceType) {
        return of("not-found", F.objectNode().put("resourceType", resourceType));
    }

    static ReviewResult staleRun() {
        return of("stale-run", F.objectNode().put("reason", "The current run has changed."));
    }
}
