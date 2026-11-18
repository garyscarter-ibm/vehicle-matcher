package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.jsText;
import static gcsp.api.comparison.ComparisonValidation.safeInteger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Port of the Node experiment request check: shape only, every problem collected, one reason per field. */
public final class ComparisonRequests {

    public static final int MAX_BASIS_LENGTH = 500;
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final String NOT_CHOSEN = "The seeds and shared settings are not chosen here. The policy values are used.";
    private static final String PROCESS = "process-only";
    private static final Map<String, String> BOUNDARY_REASONS = Map.of(
            "experimentId", "Choose one of the known comparison experiments.",
            "change", "Give the change in the shape this experiment takes.",
            "basis", "Say why this change is worth trying.",
            "overlay", "The shared settings are not valid for this experiment.",
            "seeds", "Give at least one seed, each different and not empty.");
    private static final String KEY_REASON =
            "This value is outside its allowed range, repeated, or the same as the value used today.";
    private static final Map<String, String> KEY_REASONS = Map.of(
            ComparisonExperiments.EXPERIMENT_KEYS.get("hold-sweep"),
            "Give no more holds than the policy allows, each within the allowed range, different from the others and from the hold used today.",
            ComparisonExperiments.EXPERIMENT_KEYS.get("points"),
            "The multiplier must be within the allowed range and different from the one used today.",
            ComparisonExperiments.EXPERIMENT_KEYS.get("order-mix"),
            "This mix is not valid, or is the same as the one used today.");

    private ComparisonRequests() {}

    /** The Node outcome: status ok with a value, or invalid with a code and reasons. body is the full contract object. */
    public record Outcome(String status, ObjectNode body) {

        public boolean ok() {
            return "ok".equals(status);
        }

        public JsonNode value() {
            return body.get("value");
        }

        public JsonNode reasons() {
            return body.get("reasons");
        }
    }

    private static Outcome result(String status, ObjectNode fields) {
        ObjectNode body = JSON.objectNode();
        body.put("status", status);
        body.setAll(fields);
        body.put("contractVersion", PolicyService.CONTRACT_VERSION);
        return new Outcome(status, body);
    }

    private static Outcome invalid(ArrayNode reasons) {
        ObjectNode fields = JSON.objectNode();
        fields.put("code", "invalid-experiment");
        fields.set("reasons", reasons);
        return result("invalid", fields);
    }

    private static ObjectNode reason(String field, String key, String text) {
        ObjectNode out = JSON.objectNode();
        out.put("field", field);
        if (key == null) out.putNull("key"); else out.put("key", key);
        out.put("reason", text);
        return out;
    }

    private static boolean plain(JsonNode node) {
        return node != null && node.isObject();
    }

    /** Object.keys order: integer-like keys ascending first, then insertion order. */
    private static List<String> jsKeys(JsonNode node) {
        List<String> index = new ArrayList<>();
        List<String> other = new ArrayList<>();
        node.fieldNames().forEachRemaining(name -> (isIndex(name) ? index : other).add(name));
        index.sort((a, b) -> Long.compare(Long.parseLong(a), Long.parseLong(b)));
        index.addAll(other);
        return index;
    }

    private static boolean isIndex(String key) {
        if (key.isEmpty() || key.length() > 10 || (key.length() > 1 && key.charAt(0) == '0')) return false;
        for (int i = 0; i < key.length(); i++) {
            if (key.charAt(i) < '0' || key.charAt(i) > '9') return false;
        }
        return Long.parseLong(key) <= 4294967294L;
    }

    private static ObjectNode checkChange(String id, JsonNode change, ArrayNode problems) {
        String key = ComparisonExperiments.EXPERIMENT_KEYS.get(id);
        boolean sweep = id.equals("hold-sweep");
        String field = sweep ? "values" : "value";
        if (!plain(change)) {
            problems.add(reason("change", null, "Give a change with " + (sweep ? "a list of values" : "a value") + " and a basis."));
            return null;
        }
        for (String name : jsKeys(change)) {
            if (!name.equals("basis") && !name.equals(field)) {
                problems.add(reason("change." + name, null, "This field is not recognised for this experiment."));
            }
        }
        JsonNode value = change.get(field);
        if (value == null) {
            problems.add(reason("change." + field, key, sweep ? "Give the hold lengths to try." : "Give the value to try."));
        } else if (sweep) {
            boolean whole = value.isArray() && value.size() > 0;
            if (whole) for (JsonNode item : value) whole &= safeInteger(item);
            if (!whole) {
                problems.add(reason("change.values", key, "Give a list of whole numbers of seconds."));
            } else {
                Set<Double> seen = new HashSet<>();
                for (JsonNode item : value) seen.add(item.doubleValue() + 0.0);
                if (seen.size() != value.size()) problems.add(reason("change.values", key, "Each hold length must be different."));
            }
        } else if (id.equals("points")) {
            if (!ComparisonValidation.finite(value)) problems.add(reason("change.value", key, "Give a number."));
        } else {
            boolean rows = value.isArray() && value.size() > 0;
            if (rows) for (JsonNode item : value) rows &= plain(item);
            if (!rows) problems.add(reason("change.value", key, "Give a list of model lines with weights."));
        }
        JsonNode basis = change.get("basis");
        if (basis == null || !basis.isTextual() || !jsText(basis.textValue())) {
            problems.add(reason("change.basis", null, "Say why this change is worth trying."));
        } else if (basis.textValue().length() > MAX_BASIS_LENGTH) {
            problems.add(reason("change.basis", null, "Keep this to " + MAX_BASIS_LENGTH + " characters or fewer."));
        }
        if (value == null) return null;
        ObjectNode out = JSON.objectNode();
        out.set(field, value.deepCopy());
        if (basis != null) out.set("basis", basis.deepCopy());
        return out;
    }

    /** Checks the shape of a browser or CLI experiment request; one reason per problem, in Node's order. */
    public static Outcome parse(JsonNode body) {
        ArrayNode problems = JSON.arrayNode();
        if (!plain(body)) {
            problems.add(reason("body", null, "Send a JSON object."));
            return invalid(problems);
        }
        for (String name : jsKeys(body)) {
            if (name.equals("experimentId") || name.equals("change")) continue;
            problems.add(reason(name, null, name.equals("seeds") || name.equals("overlay") ? NOT_CHOSEN : "This field is not recognised."));
        }
        JsonNode idNode = body.get("experimentId");
        boolean known = idNode != null && idNode.isTextual() && ComparisonExperiments.EXPERIMENT_IDS.contains(idNode.textValue());
        if (!known) problems.add(reason("experimentId", null, "Choose one of the known comparison experiments."));
        String id = known ? idNode.textValue() : null;
        ObjectNode change = null;
        if (known && id.equals(PROCESS)) {
            if (body.get("change") != null) problems.add(reason("change", null, "The process comparison takes no change."));
        } else if (known) {
            if (body.get("change") == null) problems.add(reason("change", null, "Give the change to try."));
            else change = checkChange(id, body.get("change"), problems);
        }
        if (problems.size() > 0) return invalid(problems);
        ObjectNode value = JSON.objectNode();
        value.put("experimentId", id);
        if (change != null) value.set("change", change);
        ObjectNode fields = JSON.objectNode();
        fields.set("value", value);
        return result("ok", fields);
    }

    /** The invalid outcome for a boundary the runner refused; a policy key is reported on the change field that carries it. */
    public static Outcome refusalFor(String boundary, String experimentId, JsonNode change) {
        Map<String, String> keys = ComparisonExperiments.EXPERIMENT_KEYS;
        String key = null;
        if (keys.containsValue(boundary)) {
            key = boundary;
        } else if (boundary.equals("overlay") && "order-mix".equals(experimentId)) {
            key = keys.get("order-mix");
        } else if (boundary.equals("change") && "hold-sweep".equals(experimentId) && change != null
                && change.get("values") != null && change.get("values").isArray()) {
            key = keys.get("hold-sweep");
        }
        ArrayNode reasons = JSON.arrayNode();
        if (key != null) {
            reasons.add(reason(key.equals(keys.get("hold-sweep")) ? "change.values" : "change.value", key, KEY_REASONS.get(key)));
        } else {
            String field = boundary.equals("basis") ? "change.basis" : boundary;
            reasons.add(reason(field, boundary.contains(".") ? boundary : null, BOUNDARY_REASONS.getOrDefault(boundary, KEY_REASON)));
        }
        return invalid(reasons);
    }

    /** The boundary a refused request names, or null when the failure is not an invalid request. */
    public static String refusedBoundary(Throwable error) {
        if (error instanceof ComparisonRunError run && run.code().equals("invalid-input")) return run.boundary();
        if (error instanceof ComparisonInputError input && input.code().startsWith("invalid-")) return input.key();
        return null;
    }
}
