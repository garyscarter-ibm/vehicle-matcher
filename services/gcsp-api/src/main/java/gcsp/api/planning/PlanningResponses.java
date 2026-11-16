package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Iterator;

/** Maps a planning outcome to HTTP: 200 {status, value}, or the typed failure with its documented status. */
final class PlanningResponses {

    private PlanningResponses() {
    }

    static int http(String status) {
        return switch (status) {
            case "ok" -> 200;
            case "invalid" -> 400;
            case "forbidden" -> 403;
            case "not-found" -> 404;
            case "conflict", "stale-version", "stale-run" -> 409;
            case "unsupported" -> 422;
            default -> 503;
        };
    }

    static Response of(ObjectNode outcome) {
        String status = outcome.path("status").asText("unavailable");
        if ("ok".equals(status)) {
            ObjectNode body = Outcomes.object();
            body.put("status", "ok");
            body.set("value", outcome.get("value"));
            return build(200, body);
        }
        ObjectNode body = outcome.deepCopy();
        if ("unsupported".equals(status) && body.has("planId")) {
            return build(422, body);
        }
        if (!body.has("status") || !body.get("status").isTextual()) {
            body.put("status", "unavailable");
        }
        if (!body.has("code")) {
            body.put("code", switch (status) {
                case "forbidden" -> "role-required";
                case "conflict" -> "planning-inputs-changed";
                default -> "order-plan-unavailable";
            });
        }
        if (!body.has("reason")) {
            body.put("reason", reason(status, body));
        }
        if (!body.has("retryable")) {
            body.put("retryable", "unavailable".equals(status) || "conflict".equals(status));
        }
        return build(http(status), body);
    }

    static Response invalid(String code, String field, String reason) {
        return of(Outcomes.invalid(code, field, reason, null));
    }

    private static String reason(String status, ObjectNode body) {
        JsonNode reasons = body.get("reasons");
        if (reasons != null && reasons.isArray() && !reasons.isEmpty()) {
            Iterator<JsonNode> each = reasons.iterator();
            JsonNode first = each.next();
            if (first.path("reason").isTextual() && !first.get("reason").textValue().isBlank()) {
                return first.get("reason").textValue();
            }
        }
        return switch (status) {
            case "invalid" -> "The order plan request could not be accepted.";
            case "forbidden" -> "Your account cannot use this action.";
            case "conflict" -> "The planning inputs changed while the plan was calculated. Try again.";
            case "unsupported" -> "This plan is larger than the planner supports.";
            default -> "The order plan is unavailable. Try again.";
        };
    }

    private static Response build(int http, ObjectNode body) {
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }
}
