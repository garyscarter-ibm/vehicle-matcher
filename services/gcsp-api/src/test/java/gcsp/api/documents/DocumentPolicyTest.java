package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.documents.DocumentPolicy.Config;
import gcsp.api.documents.DocumentPolicy.ItemDef;
import gcsp.api.documents.DocumentPolicy.Load;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class DocumentPolicyTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String VERSION = "gcsp-policy-v1";
    private static final String ITEMS = "lifecycle.documents.v1";
    private static final String SCENARIO = "lifecycle.documents.scenario.v1";
    private static final String EXCEPTIONS = "lifecycle.documents.exceptions.v1";

    /** Serves the pinned rows by key; a version mismatch is left for load to refuse. */
    private record FixturePort(JsonNode root) implements DocumentPolicyPort {

        @Override
        public Optional<DocumentPolicyPort.Assumption> assumption(String key, String policyVersion) {
            for (JsonNode row : root.get("assumptions")) {
                if (key.equals(row.get("key").asText())) return Optional.of(toAssumption(row));
            }
            return Optional.empty();
        }
    }

    @Test
    void validFixtureLoadsTheWholePinnedPolicy() throws IOException {
        Config config = loaded(fixture());
        assertEquals("sent to ordering", config.openingStage());
        assertEquals("approved", config.openingState());
        assertEquals(List.of("agreement-acknowledgement", "licence-check", "vehicle-preparation",
                "delivery-to-retailer"), ids(config.items()));
        assertEquals("Acknowledge the agreement", config.items().get(0).action());
        assertNull(config.items().get(0).progressSeconds());
        assertEquals(3600L, config.items().get(1).progressSeconds().longValue());
        assertEquals(List.of(), config.failItemIds());
        assertEquals("The provider reported this step as failed.", config.failureReason());
        assertEquals(new DocumentPolicy.ExceptionTypes("document-overdue", "document-failed"),
                config.exceptionTypes());
        assertEquals(3, config.assumptions().size());
        assertEquals(VERSION, config.assumptions().get(2).get("policyVersion").asText());
    }

    @Test
    void applicableKeepsOnlyTheItemsForTheSchemeInPolicyOrder() throws IOException {
        JsonNode root = fixture();
        item(root, "vehicle-preparation").putArray("schemeIds").add("choices-rr-production");
        Config config = loaded(root);
        assertEquals(List.of("agreement-acknowledgement", "licence-check", "delivery-to-retailer"),
                ids(DocumentPolicy.applicable(config, "choices-fs-uk")));
        assertEquals(List.of("agreement-acknowledgement", "licence-check", "vehicle-preparation",
                "delivery-to-retailer"), ids(DocumentPolicy.applicable(config, "choices-rr-production")));
        assertEquals(List.of(), ids(DocumentPolicy.applicable(config, "unknown-scheme")));
    }

    @Test
    void failItemNamingASchemeTeamItemIsLoaded() throws IOException {
        JsonNode root = fixture();
        value(root, SCENARIO).putArray("failItemIds").add("licence-check");
        assertEquals(List.of("licence-check"), loaded(root).failItemIds());
    }

    @Test
    void policyVersionMismatchIsUnavailable() throws IOException {
        JsonNode root = fixture();
        assumption(root, SCENARIO).put("policyVersion", "gcsp-policy-v0");
        assertUnavailable(root);
    }

    @Test
    void missingKeyIsUnavailable() throws IOException {
        JsonNode root = fixture();
        removeAssumption(root, EXCEPTIONS);
        assertUnavailable(root);
    }

    @Test
    void badStatusIsUnavailable() throws IOException {
        JsonNode root = fixture();
        assumption(root, ITEMS).put("status", "draft");
        assertUnavailable(root);
    }

    @Test
    void employeeItemWithProgressIsUnavailable() throws IOException {
        JsonNode root = fixture();
        item(root, "agreement-acknowledgement").put("progressSeconds", 10);
        assertUnavailable(root);
    }

    @Test
    void providerItemWithActionIsUnavailable() throws IOException {
        JsonNode root = fixture();
        item(root, "licence-check").put("action", "Check the licence");
        assertUnavailable(root);
    }

    @Test
    void progressBeyondDueIsUnavailable() throws IOException {
        JsonNode root = fixture();
        item(root, "licence-check").put("progressSeconds", 90000);
        assertUnavailable(root);
    }

    @Test
    void duplicateItemIdIsUnavailable() throws IOException {
        JsonNode root = fixture();
        item(root, "licence-check").put("itemId", "agreement-acknowledgement");
        assertUnavailable(root);
    }

    @Test
    void failItemNamingTheEmployeeItemIsUnavailable() throws IOException {
        JsonNode root = fixture();
        value(root, SCENARIO).putArray("failItemIds").add("agreement-acknowledgement");
        assertUnavailable(root);
    }

    @Test
    void equalOverdueAndFailedTypesAreUnavailable() throws IOException {
        JsonNode root = fixture();
        value(root, EXCEPTIONS).put("failed", "document-overdue");
        assertUnavailable(root);
    }

    @Test
    void unavailableCarriesTheSharedCodeAndReason() {
        assertEquals("document-policy-unavailable", Load.Unavailable.CODE);
        assertEquals("Document and readiness policy is unavailable. Ask the scheme team to check the scheme setup.",
                Load.Unavailable.REASON);
    }

    private static JsonNode fixture() throws IOException {
        return MAPPER.readTree(Files.readString(
                Path.of("../../server/test/fixtures/gcsp-lifecycle-documents-policy-patch.json")));
    }

    private static Config loaded(JsonNode root) {
        return assertInstanceOf(Load.Loaded.class, DocumentPolicy.load(new FixturePort(root), VERSION)).config();
    }

    private static void assertUnavailable(JsonNode root) {
        assertInstanceOf(Load.Unavailable.class, DocumentPolicy.load(new FixturePort(root), VERSION));
    }

    private static List<String> ids(List<ItemDef> items) {
        return items.stream().map(ItemDef::itemId).toList();
    }

    private static ObjectNode assumption(JsonNode root, String key) {
        for (JsonNode row : root.get("assumptions")) {
            if (key.equals(row.get("key").asText())) return (ObjectNode) row;
        }
        throw new IllegalArgumentException(key);
    }

    /** The assumption's own value object, where the items, scenario and exception types are held. */
    private static ObjectNode value(JsonNode root, String key) {
        return (ObjectNode) assumption(root, key).get("value");
    }

    private static ObjectNode item(JsonNode root, String itemId) {
        for (JsonNode row : value(root, ITEMS).get("items")) {
            if (itemId.equals(row.get("itemId").asText())) return (ObjectNode) row;
        }
        throw new IllegalArgumentException(itemId);
    }

    private static void removeAssumption(JsonNode root, String key) {
        ArrayNode rows = (ArrayNode) root.get("assumptions");
        for (int i = 0; i < rows.size(); i++) {
            if (key.equals(rows.get(i).get("key").asText())) {
                rows.remove(i);
                return;
            }
        }
    }

    private static DocumentPolicyPort.Assumption toAssumption(JsonNode row) {
        return new DocumentPolicyPort.Assumption(row.get("key").asText(), row.get("value"),
                row.get("unit").asText(), row.get("status").asText(), row.get("basis").asText(),
                row.get("source").asText(), row.get("sourceDate").asText(), row.get("policyVersion").asText());
    }
}
