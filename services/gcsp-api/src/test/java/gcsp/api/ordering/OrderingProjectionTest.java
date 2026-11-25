package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class OrderingProjectionTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ORDER = "00000000-0000-4000-8000-000000000593";

    @Test
    void projectsTheExactAcceptedQuoteSnapshotDisplayWithoutLeakingSavedDetails() throws Exception {
        ObjectNode selection = selection();
        JsonNode original = selection.deepCopy();
        JsonNode projected = OrderingProjection.of(row(selection, "acknowledged"));

        assertEquals(ORDER, projected.at("/selection/stock/orderUuid").asText());
        assertEquals(JSON.readTree("""
                {"name":"BMW X2 M35i in Black Sapphire","photo":"/assets/selected-car.jpg",
                 "images":[{"src":"https://images.example.test/selected-side.jpg"}]}
                """), projected.at("/selection/stock/facts/display"));
        assertFalse(projected.path("selection").has("quote"));
        assertFalse(projected.toString().contains("private-value"));
        assertEquals(original, selection, "a read must not rewrite the immutable selection");
    }

    @Test
    void preservesDisplayAlreadySavedWithTheSelectedStock() throws Exception {
        ObjectNode selection = selection();
        ((ObjectNode) selection.at("/stock/facts")).set("display", JSON.readTree("""
                {"name":"Saved cart car","images":[{"src":"/assets/cart-car.jpg","private":"private-value"}]}
                """));
        assertEquals(JSON.readTree("""
                {"name":"Saved cart car","images":[{"src":"/assets/cart-car.jpg"}]}
                """), OrderingProjection.of(row(selection, "pending")).at("/selection/stock/facts/display"));
    }

    @Test
    void projectsTheManualSelectionFactsWrapperWithItsExactSnapshotIdentity() throws Exception {
        ObjectNode selection = selection();
        ((ObjectNode) selection.at("/stock/facts")).set("facts", selection.at("/quote/snapshot").deepCopy());
        ((ObjectNode) selection.get("quote")).remove("snapshot");
        assertEquals(JSON.readTree("""
                {"name":"BMW X2 M35i in Black Sapphire","photo":"/assets/selected-car.jpg",
                 "images":[{"src":"https://images.example.test/selected-side.jpg"}]}
                """), OrderingProjection.of(row(selection, "acknowledged")).at("/selection/stock/facts/display"));

        ((ObjectNode) selection.at("/stock/facts/facts/sourceKeys")).put("stockId", "another-order");
        assertTrue(OrderingProjection.of(row(selection, "acknowledged"))
                .at("/selection/stock/facts/display").isMissingNode());
    }

    @Test
    void doesNotAttachDisplayFromAnotherStockQuoteOrSnapshot() throws Exception {
        for (String identity : new String[] {"stock", "quote", "snapshot"}) {
            ObjectNode selection = selection();
            if (identity.equals("snapshot")) {
                ((ObjectNode) selection.at("/quote/snapshot/sourceKeys")).put("stockId", "another-order");
            } else {
                ((ObjectNode) selection.get(identity)).put("orderUuid", "another-order");
            }
            assertTrue(OrderingProjection.of(row(selection, "acknowledged"))
                    .at("/selection/stock/facts/display").isMissingNode(), identity);
        }
    }

    @Test
    void leavesGenuinelyMissingDisplayMissing() throws Exception {
        ObjectNode selection = selection();
        ((ObjectNode) selection.at("/quote/snapshot")).remove("display");
        assertTrue(OrderingProjection.of(row(selection, "acknowledged"))
                .at("/selection/stock/facts/display").isMissingNode());
    }

    @Test
    void copiesOnlySupportedTextFieldsAndImageSources() throws Exception {
        ObjectNode selection = selection();
        ((ObjectNode) selection.at("/quote/snapshot")).set("display", JSON.readTree("""
                {"name":"Supplied car","photo":{"private":"private-value"},
                 "images":[{"src":"/assets/car.jpg","alt":"private-value"},null,{"src":12}],
                 "manufacturer":"private-value","link":"private-value"}
                """));
        assertEquals(JSON.readTree("""
                {"name":"Supplied car","images":[{"src":"/assets/car.jpg"}]}
                """), OrderingProjection.of(row(selection, "acknowledged")).at("/selection/stock/facts/display"));
    }

    @Test
    void retainsFlatMetadataAndExistingHandoffStatusSemantics() throws Exception {
        JsonNode projected = OrderingProjection.of(row(selection(), "refused"));
        assertEquals("refused", projected.path("status").asText());
        assertEquals("operation-593", projected.path("operationId").asText());
        assertEquals("GCSP-000593", projected.path("orderReference").asText());
        JsonNode flat = projected.path("selection");
        assertEquals("buddy", flat.path("sourceType").asText());
        assertEquals("hold-593", flat.path("holdId").asText());
        assertEquals(ORDER, flat.path("orderUuid").asText());
        assertEquals("1862990", flat.path("orderNumber").asText());
        assertEquals("configuration-593", flat.path("configurationId").asText());
        assertEquals("quote-593", flat.path("quoteId").asText());
        assertEquals("terms-593", flat.path("termsVersion").asText());
        assertEquals("policy-593", flat.path("policyVersion").asText());
        assertEquals("2026-11-25T11:30:00Z", flat.path("receivedAt").asText());
        assertEquals("handoff-failed", projected.at("/progress/selectionState").asText());
        assertEquals("failed", projected.at("/progress/stages/0/state").asText());
        assertEquals("not-started", projected.at("/progress/stages/1/state").asText());
        assertEquals("contact-support", projected.at("/view/action").asText());
        assertEquals("provider-refused", projected.at("/failure/reason").asText());
        assertEquals(2, projected.path("attempts").asInt());
        assertFalse(projected.has("providerReference"));
    }

    private static ObjectNode selection() throws Exception {
        return (ObjectNode) JSON.readTree("""
                {"receivedAt":"2026-11-25T11:30:00Z",
                 "stock":{"orderUuid":"00000000-0000-4000-8000-000000000593",
                          "orderNumber":"1862990","configurationId":"configuration-593",
                          "facts":{"seats":{"value":5},"private":"private-value"}},
                 "quote":{"orderUuid":"00000000-0000-4000-8000-000000000593","quoteId":"quote-593",
                          "employeeFacts":{"private":"private-value"},
                          "snapshot":{"identityKind":"exact-stock",
                                      "sourceKeys":{"stockId":"00000000-0000-4000-8000-000000000593"},
                                      "display":{"name":"BMW X2 M35i in Black Sapphire",
                                                 "photo":"/assets/selected-car.jpg",
                                                 "images":[{"src":"https://images.example.test/selected-side.jpg",
                                                            "alt":"private-value"}],"link":"private-value"}}},
                 "terms":{"termsVersion":"terms-593","approvalStages":["HR approval"]},
                 "employee":{"private":"private-value"},"reviewDetails":{"private":"private-value"}}
                """);
    }

    private static OrderingProjection.Row row(JsonNode selection, String state) {
        return new OrderingProjection.Row("operation-593", "employee-593", "slot-593", "buddy", "hold-593", ORDER,
                "GCSP-000593", "policy-593", selection, Instant.parse("2026-11-25T12:00:00Z"), state,
                7, 3, "provider-593", JSON.createObjectNode().put("reason", "provider-refused"), "digest-593");
    }
}
