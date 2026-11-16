package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The result, unavailable, invalid, refused and forbidden shapes of server/gcsp/recommendation/index.js. */
final class Outcomes {

    static final String CONTRACT_VERSION = "1.0.0";

    private Outcomes() {}

    static ObjectNode result(String status, ObjectNode fields) {
        ObjectNode out = Js.obj();
        out.put("status", status);
        if (fields != null) out.setAll(fields);
        out.put("contractVersion", CONTRACT_VERSION);
        return out;
    }

    static ObjectNode unavailable(String code) {
        return result("unavailable", new Js.B().s("code", code)
                .s("reason", "The employee recommendation source is unavailable.").s("retryable", true).build());
    }

    static ObjectNode invalid(String code, JsonNode reasons) {
        return result("invalid", new Js.B().s("code", code).s("reasons", reasons).build());
    }

    static ObjectNode refused() {
        return result("stale-run", new Js.B().s("reason", "The supplied employee data does not belong to this current context.").build());
    }

    static ObjectNode forbidden() {
        return result("forbidden", new Js.B().s("reason", "An employee context is required.").build());
    }

    static ArrayNode one(String field, String reason) {
        ArrayNode list = Js.arr();
        list.add(new Js.B().s("field", field).s("reason", reason).build());
        return list;
    }
}
