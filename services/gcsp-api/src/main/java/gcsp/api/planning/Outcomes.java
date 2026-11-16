package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The typed outcomes of the planning operations, in the same JSON shapes as Node's result(). */
final class Outcomes {

    static final JsonNodeFactory F = JsonNodeFactory.instance;
    static final String OPERATIONS_UNAVAILABLE = "The order plan is unavailable. Try again.";

    private Outcomes() {
    }

    static ObjectNode object() {
        return F.objectNode();
    }

    private static ObjectNode of(String status) {
        ObjectNode n = F.objectNode();
        n.put("status", status);
        n.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        return n;
    }

    /** The planner's own unavailable outcome: status, code, contractVersion. */
    static ObjectNode unavailable(String code) {
        ObjectNode n = F.objectNode();
        n.put("status", "unavailable");
        n.put("code", code);
        n.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        return n;
    }

    /** The operations layer's unavailable outcome, with retry advice. */
    static ObjectNode operationsUnavailable(String code) {
        ObjectNode n = of("unavailable");
        n.put("code", code);
        n.put("retryable", true);
        n.put("reason", OPERATIONS_UNAVAILABLE);
        return n;
    }

    static ObjectNode invalid(String code, String field, String reason, ObjectNode extra) {
        ObjectNode n = of("invalid");
        n.put("code", code);
        if (extra != null) {
            n.setAll(extra);
        }
        n.putArray("reasons").addObject().put("field", field).put("reason", reason);
        return n;
    }

    static ObjectNode forbidden() {
        ObjectNode n = of("forbidden");
        n.put("reason", "This person cannot perform that action.");
        return n;
    }

    static ObjectNode conflict(String code) {
        ObjectNode n = of("conflict");
        n.put("code", code);
        return n;
    }

    static ObjectNode ok(JsonNode value) {
        ObjectNode n = of("ok");
        n.set("value", value);
        return n;
    }

    static boolean isOk(JsonNode result) {
        return result != null && result.has("status") && "ok".equals(result.get("status").textValue());
    }

    static ArrayNode array() {
        return F.arrayNode();
    }
}
