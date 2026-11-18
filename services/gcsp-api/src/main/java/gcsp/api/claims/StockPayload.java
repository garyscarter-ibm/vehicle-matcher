package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Wire form of the manual stock answer (manual-stock-compact-v1): a port of manual-gallery/stock-payload.js. */
public final class StockPayload {

    public static final String SHAPE = "manual-stock-compact-v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private StockPayload() {}

    /** Shared decision versions and repeated cars are sent once; any shape that does not fit is returned unchanged. */
    public static JsonNode compact(JsonNode value) {
        if (value == null || !value.isObject()) return value;
        JsonNode decisions = value.get("decisions");
        JsonNode cars = value.get("cars");
        JsonNode versions = value.get("versions");
        if (decisions == null || !decisions.isArray() || cars == null || !cars.isArray() || versions == null
                || !versions.isObject() || value.has("payloadShape")) return value;
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        for (JsonNode row : decisions) {
            if (!row.isObject() || !row.has("versions") || !row.get("versions").isObject()
                    || !row.has("orderUuid") || !row.get("orderUuid").isTextual()) return value;
            byId.put(row.get("orderUuid").textValue(), row);
        }
        if (byId.size() != decisions.size()) return value;
        for (JsonNode car : cars) {
            JsonNode id = car.isObject() ? car.get("orderUuid") : null;
            JsonNode row = id != null && id.isTextual() ? byId.get(id.textValue()) : null;
            if (row == null || row != car && !Canonical.json(row).equals(Canonical.json(car))) return value;
        }
        List<String> shared = new ArrayList<>();
        versions.fieldNames().forEachRemaining(key -> {
            boolean every = decisions.size() > 0;
            for (JsonNode row : decisions) {
                JsonNode pin = row.get("versions");
                every &= pin.has(key) && Canonical.json(pin.get(key)).equals(Canonical.json(versions.get(key)));
            }
            if (every) shared.add(key);
        });
        ObjectNode out = ((ObjectNode) value).deepCopy();
        out.remove("cars");
        out.put("payloadShape", SHAPE);
        ArrayNode keys = out.putArray("sharedVersionKeys");
        shared.forEach(keys::add);
        ArrayNode ids = out.putArray("carIds");
        cars.forEach(car -> ids.add(car.get("orderUuid")));
        Set<String> drop = new HashSet<>(shared);
        ArrayNode rows = F.arrayNode();
        for (JsonNode row : decisions) {
            ObjectNode copy = ((ObjectNode) row).deepCopy();
            ObjectNode pin = F.objectNode();
            row.get("versions").fields().forEachRemaining(e -> {
                if (!drop.contains(e.getKey())) pin.set(e.getKey(), e.getValue());
            });
            copy.set("versions", pin);
            rows.add(copy);
        }
        out.set("decisions", rows);
        return out;
    }
}
