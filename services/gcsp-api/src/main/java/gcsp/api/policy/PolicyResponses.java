package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Iterator;
import java.util.List;

/** Maps a PolicyResult to 200 {status, value} or the typed failure envelope plus the policy's own extra fields. */
final class PolicyResponses {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final List<String> EXTRAS =
            List.of("reasons", "accepted", "expectedVersion", "currentVersion", "action", "operationId");

    private PolicyResponses() {
    }

    static Response ok(JsonNode value) {
        ObjectNode body = JSON.objectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).type(MediaType.APPLICATION_JSON_TYPE).build();
    }

    static int http(PolicyResult result) {
        return switch (result.status()) {
            case "ok" -> 200;
            case "invalid" -> "unsupported-operation".equals(result.code()) ? 422 : 400;
            case "forbidden" -> 403;
            case "not-found" -> 404;
            case "stale-version", "conflict", "stale-run" -> 409;
            case "uncertain" -> 202;
            default -> 503;
        };
    }

    /** The one 422 the preview route answers until Greg demand and fit exist in Java. */
    static Response previewUnavailable() {
        return build(422, envelope("unsupported", "preview-unavailable", "Policy preview is not available on this service yet.",
                false));
    }

    /** A typed failure for a request the route itself refuses (bad body, bad query). */
    static Response invalid(String code, String field, String reason) {
        ObjectNode body = envelope("invalid", code, reason, false);
        body.putArray("reasons").addObject().put("field", field).put("reason", reason);
        return build(400, body);
    }

    static Response failure(PolicyResult result) {
        int http = http(result);
        String status = http == 422 ? "unsupported" : result.status();
        ObjectNode body = envelope(status, code(result), reason(result), retryable(result));
        for (String extra : EXTRAS) {
            if (result.body().has(extra)) {
                body.set(extra, result.body().get(extra).deepCopy());
            }
        }
        return build(http, body);
    }

    private static ObjectNode envelope(String status, String code, String reason, boolean retryable) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.put("code", code);
        body.put("reason", reason);
        body.put("retryable", retryable);
        return body;
    }

    private static Response build(int http, ObjectNode body) {
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }

    private static String code(PolicyResult result) {
        String code = result.code();
        if (code != null && !code.isBlank()) {
            return code;
        }
        return switch (result.status()) {
            case "forbidden" -> "role-required";
            case "unavailable" -> "policy-unavailable";
            case "invalid" -> "invalid-policy-change";
            default -> result.status();
        };
    }

    private static String reason(PolicyResult result) {
        JsonNode given = result.body().get("reason");
        if (given != null && given.isTextual() && !given.textValue().isBlank()) {
            return given.textValue();
        }
        JsonNode reasons = result.body().get("reasons");
        if (reasons != null && reasons.isArray() && !reasons.isEmpty()) {
            Iterator<JsonNode> each = reasons.iterator();
            JsonNode first = each.next();
            if (first.path("reason").isTextual() && !first.get("reason").textValue().isBlank()) {
                return first.get("reason").textValue();
            }
        }
        return switch (result.status()) {
            case "stale-version" -> "The policy changed. Refresh and try again.";
            case "stale-run" -> PolicyBodies.STALE_RUN_REASON;
            case "forbidden" -> PolicyBodies.FORBIDDEN_REASON;
            case "not-found" -> "The requested policy was not found.";
            case "conflict" -> "This request conflicts with an earlier one. Refresh and try again.";
            case "invalid" -> "The policy change could not be accepted.";
            case "uncertain" -> "The change may or may not have been saved. Check before trying again.";
            default -> "The policy source is unavailable.";
        };
    }

    private static boolean retryable(PolicyResult result) {
        JsonNode given = result.body().get("retryable");
        if (given != null && given.isBoolean()) {
            return given.booleanValue();
        }
        return "unavailable".equals(result.status());
    }
}
