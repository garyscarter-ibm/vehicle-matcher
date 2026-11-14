package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Small JSON helpers shared by the demand classes. */
final class Demand {

    static final ObjectMapper M = new ObjectMapper();

    private Demand() {}

    static ObjectNode obj() {
        return M.createObjectNode();
    }

    static ArrayNode arr() {
        return M.createArrayNode();
    }

    /** A stored JSON text, or null for SQL NULL. */
    static JsonNode parse(String json) throws java.io.IOException {
        return json == null ? null : M.readTree(json);
    }

    /** A known fact's value ({status:"known", value}), else null. */
    static JsonNode known(JsonNode fact) {
        return fact != null && "known".equals(fact.path("status").asText(null)) && fact.hasNonNull("value")
                ? fact.get("value") : null;
    }
}
