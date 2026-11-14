package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** A lookup request; malformed marks extra keys or wrong types that Node reports as invalid-input. */
public record EvidenceRequest(String kind, String id, Map<String, String> expected, boolean malformed) {

    public EvidenceRequest(String kind, String id, Map<String, String> expected) {
        this(kind, id, expected, false);
    }

    /** Reads a transport request object the way Node's request validation does. */
    public static EvidenceRequest fromJson(JsonNode node) {
        if (node == null || !node.isObject()) return new EvidenceRequest(null, null, null, true);
        boolean malformed = false;
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            if (!Set.of("kind", "id", "expected").contains(it.next())) malformed = true;
        }
        JsonNode kind = node.get("kind");
        JsonNode id = node.get("id");
        Map<String, String> expected = null;
        if (node.has("expected")) {
            JsonNode pins = node.get("expected");
            if (pins.isObject()) {
                expected = new LinkedHashMap<>();
                for (Iterator<Map.Entry<String, JsonNode>> it = pins.fields(); it.hasNext(); ) {
                    Map.Entry<String, JsonNode> entry = it.next();
                    if (entry.getValue().isTextual()) expected.put(entry.getKey(), entry.getValue().textValue());
                    else malformed = true;
                }
            } else {
                malformed = true;
            }
        }
        return new EvidenceRequest(kind != null && kind.isTextual() ? kind.textValue() : null,
                id != null && id.isTextual() ? id.textValue() : null, expected, malformed);
    }
}
