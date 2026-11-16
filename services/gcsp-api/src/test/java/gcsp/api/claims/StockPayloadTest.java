package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** compactStockPayload (manual-stock-compact-v1): the wire shape, the round trip and every fall-back to the plain shape. */
class StockPayloadTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static ObjectNode decision(String id, String clock, String availability) {
        ObjectNode d = JSON.createObjectNode().put("orderUuid", id).put("gateStatus", "eligible");
        d.putObject("versions").put("brief", 3).put("policy", "p1").put("clock", clock).put("availability", availability);
        return d;
    }

    private static ObjectNode value(Consumer<ObjectNode> edit) {
        ObjectNode v = JSON.createObjectNode().put("state", "available-stock");
        ArrayNode decisions = v.putArray("decisions");
        decisions.add(decision("a", "c1", "t1")).add(decision("b", "c1", "t2")).add(decision("c", "c1", "t3"));
        ((ObjectNode) decisions.get(2)).put("gateStatus", "ineligible");
        ArrayNode cars = v.putArray("cars");
        cars.add(decisions.get(0).deepCopy()).add(decisions.get(1).deepCopy());
        v.put("total", 2);
        v.putObject("versions").put("brief", 3).put("policy", "p1").put("clock", "c1").put("draft", 3).put("context", "x");
        edit.accept(v);
        return v;
    }

    /** What validateStockPayload does with a compact answer: put the shared pins back and rebuild cars from carIds. */
    private static ObjectNode expand(JsonNode compact) {
        ObjectNode out = ((ObjectNode) compact).deepCopy();
        out.remove(java.util.List.of("payloadShape", "sharedVersionKeys", "carIds"));
        ArrayNode rows = JSON.createArrayNode();
        for (JsonNode row : compact.get("decisions")) {
            ObjectNode copy = ((ObjectNode) row).deepCopy();
            for (JsonNode key : compact.get("sharedVersionKeys")) {
                ((ObjectNode) copy.get("versions")).set(key.textValue(), compact.get("versions").get(key.textValue()));
            }
            rows.add(copy);
        }
        ArrayNode cars = out.putArray("cars");
        for (JsonNode id : compact.get("carIds")) {
            for (JsonNode row : rows) if (row.get("orderUuid").equals(id)) cars.add(row);
        }
        out.set("decisions", rows);
        return out;
    }

    @Test
    void sharedVersionsAndRepeatedCarsAreSentOnce() {
        JsonNode full = value(v -> {});
        JsonNode compact = StockPayload.compact(full);
        assertEquals("manual-stock-compact-v1", compact.get("payloadShape").asText());
        assertEquals("[\"brief\",\"policy\",\"clock\"]", compact.get("sharedVersionKeys").toString());
        assertEquals("[\"a\",\"b\"]", compact.get("carIds").toString());
        assertFalse(compact.has("cars"));
        for (JsonNode row : compact.get("decisions")) {
            assertEquals(1, row.get("versions").size());
            assertTrue(row.get("versions").has("availability"));
        }
        assertEquals(full.get("versions"), compact.get("versions"));
        assertEquals("available-stock", compact.get("state").asText());
        assertEquals(2, compact.get("total").asInt());
        assertTrue(full.has("cars"), "the input is not changed");
    }

    @Test
    void theCompactFormExpandsBackToTheFullAnswer() {
        JsonNode full = value(v -> {});
        assertEquals(Canonical.json(full), Canonical.json(expand(StockPayload.compact(full))));
    }

    @Test
    void aVersionThatDiffersInOneDecisionIsNotShared() {
        JsonNode compact = StockPayload.compact(value(v -> {
            ((ObjectNode) v.get("decisions").get(1).get("versions")).put("clock", "c2");
            ((ObjectNode) v.get("cars").get(1).get("versions")).put("clock", "c2");
        }));
        assertEquals("[\"brief\",\"policy\"]", compact.get("sharedVersionKeys").toString());
        assertEquals("c2", compact.get("decisions").get(1).get("versions").get("clock").asText());
    }

    @Test
    void noDecisionsShareNothingAndNoCarsStillCompacts() {
        JsonNode compact = StockPayload.compact(value(v -> {
            v.putArray("decisions");
            v.putArray("cars");
            v.put("total", 0).put("state", "empty-stock");
        }));
        assertEquals("manual-stock-compact-v1", compact.get("payloadShape").asText());
        assertEquals(0, compact.get("sharedVersionKeys").size());
        assertEquals(0, compact.get("carIds").size());
    }

    private static void unchanged(Consumer<ObjectNode> edit) {
        ObjectNode v = value(edit);
        String before = Canonical.json(v);
        assertSame(v, StockPayload.compact(v));
        assertEquals(before, Canonical.json(v));
    }

    @Test
    void anythingThatDoesNotFitFallsBackToThePlainShape() {
        assertSame(null, StockPayload.compact(null));
        unchanged(v -> v.put("payloadShape", "manual-stock-compact-v1"));
        unchanged(v -> v.remove("decisions"));
        unchanged(v -> v.put("decisions", "no"));
        unchanged(v -> v.remove("cars"));
        unchanged(v -> v.putArray("cars").add("a"));
        unchanged(v -> v.remove("versions"));
        unchanged(v -> v.putArray("versions"));
        unchanged(v -> ((ObjectNode) v.get("decisions").get(0)).remove("versions"));
        unchanged(v -> ((ObjectNode) v.get("decisions").get(0)).putArray("versions"));
        unchanged(v -> ((ObjectNode) v.get("decisions").get(0)).remove("orderUuid"));
        unchanged(v -> ((ObjectNode) v.get("decisions").get(0)).put("orderUuid", 7));
        unchanged(v -> ((ObjectNode) v.get("decisions").get(1)).put("orderUuid", "a"));
        unchanged(v -> ((ObjectNode) v.get("cars").get(0)).put("gateStatus", "ineligible"));
        unchanged(v -> ((ObjectNode) v.get("cars").get(0)).put("orderUuid", "zzz"));
        unchanged(v -> ((ArrayNode) v.get("decisions")).add("row"));
    }

    @Test
    void aNonObjectIsReturnedAsIs() {
        JsonNode text = JSON.getNodeFactory().textNode("x");
        assertSame(text, StockPayload.compact(text));
    }
}
