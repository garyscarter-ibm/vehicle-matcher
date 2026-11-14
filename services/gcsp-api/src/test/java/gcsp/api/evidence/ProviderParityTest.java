package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CorpusResults.VinResult;
import gcsp.api.evidence.StockPort.StockClassification;
import gcsp.api.evidence.VehicleRouting.Route;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Both provider shapes, the failure matrix and the server-owned routing must equal Node's recorded outputs. */
class ProviderParityTest {

    private static final JsonNode PROVIDERS = EvidenceFixtures.golden("s4-providers.json");
    private static final JsonNode MATRIX = EvidenceFixtures.golden("s4-matrix.json");
    private static final EvidenceContext CONTEXT = EvidenceContext.fromJson(PROVIDERS.get("context"));

    private static CorpusStore store(String name) {
        return LookupCases.store(name);
    }

    private static VehicleDetailsConsumer consumer(String provider) {
        CorpusStore store = store("lookup-reference.v1");
        JsonNode stockRow = stockRow(store);
        StockPort stock = ProviderCases.stock(CONTEXT, stockRow, StockClassification.ok(stockRow.get("configurationId").textValue(), "fictional-stock-car"));
        VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(DecoratorFixtures.stack(EvidenceRegistry.of(store),
                DecoratorFixtures.catalogue(), new ConfigurationDefinitions(DecoratorFixtures.SEED)), stock);
        VehicleRouting route = new VehicleRouting(store, stock, provider);
        return VehicleDetailsConsumer.configured(provider, lookup, new OfflineCardFile(ProviderCases.ALTERNATE), route, 1000, 1);
    }

    private static JsonNode stockRow(CorpusStore store) {
        VinResult vin = store.getVin("WBA33DB08TC426611");
        JsonNode vehicle = vin.vehicle();
        ObjectNode row = EvidenceFixtures.MAPPER.createObjectNode();
        row.put("runId", CONTEXT.runId());
        row.put("orderUuid", ProviderCases.ALTERNATE_FIXTURE.get("entries").get(3).get("key").get("token").textValue());
        row.put("orderNumber", "0000123");
        row.put("configurationId", vehicle.get("configurationId").textValue());
        ObjectNode identity = row.putObject("facts").putObject("syntheticIdentity");
        identity.put("identityKind", "synthetic");
        identity.put("vehicleId", "fictional-stock-car");
        identity.put("originatingDatasetId", "consumer-fixture");
        identity.set("snapshotVersion", vehicle.get("snapshotVersion"));
        identity.set("configurationHash", vehicle.get("configurationHash"));
        return row;
    }

    @Test
    void bothProvidersEqualNodeAndShareOneVehicleExceptImagery() {
        VehicleDetailsConsumer lookup = consumer("lookup");
        VehicleDetailsConsumer alternate = consumer("alternate-offline");
        assertEquals(4, PROVIDERS.get("cases").size());
        for (JsonNode entry : PROVIDERS.get("cases")) {
            EvidenceRequest request = EvidenceRequest.fromJson(entry.get("request"));
            ObjectNode a = lookup.resolve(request, CONTEXT);
            ObjectNode b = alternate.resolve(request, CONTEXT);
            String name = entry.get("request").get("kind").textValue();
            assertNull(LookupCases.diff("$", entry.get("lookup"), a), name + " lookup");
            assertNull(LookupCases.diff("$", entry.get("alternate"), b), name + " alternate");
            assertEquals(entry.get("withoutImagesDigest").textValue(), CanonicalJson.digest(withoutImages(a.get("vehicle"))), name);
            assertEquals(CanonicalJson.digest(withoutImages(a.get("vehicle"))), CanonicalJson.digest(withoutImages(b.get("vehicle"))), name);
            assertEquals("in-process", a.get("transport").get("protocol").textValue());
            assertTrue(a.get("transport").get("status").isNull());
            assertEquals("offline", b.get("transport").get("protocol").textValue());
            assertEquals(200, b.get("transport").get("status").intValue());
            assertEquals("unknown", b.get("vehicle").get("images").get("state").textValue());
            for (String leak : new String[] {"provider", "providerVersion", "card", "dimensions", "portraits"}) {
                assertTrue(!b.get("vehicle").has(leak), leak);
            }
        }
    }

    private static JsonNode withoutImages(JsonNode vehicle) {
        ObjectNode copy = vehicle.deepCopy();
        copy.remove("images");
        ((ObjectNode) copy.get("equipment")).remove("resolution");
        ((ObjectNode) copy.get("completeness")).remove("images");
        ((ObjectNode) copy.get("presentation")).remove("imageLabel");
        return copy;
    }

    @Test
    void everyMatrixCaseEqualsNodesConsumerResult() {
        JsonNode cases = MATRIX.get("cases");
        assertTrue(cases.size() > 150, "case count " + cases.size());
        for (JsonNode entry : cases) {
            String name = entry.get("name").textValue();
            ProviderCases.Counts counts = new ProviderCases.Counts();
            ObjectNode actual = ProviderCases.run(MATRIX, entry, counts);
            if (entry.has("result")) {
                String diff = LookupCases.diff("$", entry.get("result"), actual);
                assertNull(diff, name + " -> " + diff);
            } else {
                assertEquals(entry.get("resultStatus").textValue(), actual.get("status").textValue(), name);
                assertEquals(entry.get("resultDigest").textValue(), CanonicalJson.digest(actual), name + " digest");
            }
            if (entry.path("neverRead").asBoolean(false)) assertEquals(0, counts.reads.get(), name + " must not read the provider");
        }
    }

    @Test
    void routingOutcomesEqualNodeForRetainedAndFixtureStores() {
        JsonNode stores = EvidenceFixtures.golden("s4-routing.json").get("stores");
        assertEquals(8, stores.size());
        for (Iterator<Map.Entry<String, JsonNode>> it = stores.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            CorpusStore store = entry.getKey().equals("lookup-reference.v1") ? store(entry.getKey())
                    : fixtureStore(entry.getKey());
            VehicleRouting routing = new VehicleRouting(store, null, "lookup");
            for (JsonNode expected : entry.getValue()) {
                Route actual = routing.route(EvidenceRequest.fromJson(expected.get("request")), null);
                String label = entry.getKey() + " " + expected.get("request");
                JsonNode outcome = expected.get("route");
                if (outcome.isTextual()) {
                    assertEquals(outcome.textValue(), actual.denial(), label);
                } else {
                    assertNull(actual.denial(), label);
                    assertEquals(outcome.get("configurationId").textValue(), actual.configurationId(), label);
                    assertEquals(outcome.get("vehicleId").isNull() ? null : outcome.get("vehicleId").textValue(), actual.vehicleId(), label);
                }
            }
        }
    }

    private static CorpusStore fixtureStore(String name) {
        Path root = EvidenceFixtures.required(EvidenceFixtures.RESOURCES.resolve("stores").resolve(name)).toAbsolutePath();
        CorpusStore store = new CorpusStore(root);
        store.load();
        return store;
    }

    @Test
    void anOfflineFileThatCannotBeReadMakesEveryReadFailNeverAnEmptySuccess(@org.junit.jupiter.api.io.TempDir Path dir) throws Exception {
        for (String content : new String[] {null, "{bad", "{\"entries\":5}", "{\"entries\":[{\"key\":1}]}"}) {
            Path file = dir.resolve("cards-" + (content == null ? "absent" : Integer.toHexString(content.hashCode())) + ".json");
            if (content != null) Files.writeString(file, content);
            OfflineCardFile reader = new OfflineCardFile(file);
            org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> reader.read("composition", "x", CONTEXT));
        }
        Path big = dir.resolve("big.json");
        Files.write(big, new byte[(int) OfflineCardFile.MAX_BYTES + 1]);
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> new OfflineCardFile(big).read("composition", "x", CONTEXT));
        OfflineCardFile real = new OfflineCardFile(ProviderCases.ALTERNATE);
        assertEquals("missing", real.read("composition", "unknown", CONTEXT).document().get("result").textValue());
        String order = ProviderCases.ALTERNATE_FIXTURE.get("entries").get(3).get("key").get("token").textValue();
        assertEquals("mismatch", real.read("order", order, EvidenceContext.fromJson(PROVIDERS.get("context")).roles() == null ? null
                : new EvidenceContext("old-run", CONTEXT.environmentId(), CONTEXT.principalId(), CONTEXT.roles())).document().get("result").textValue());
        assertNotNull(real.read("order", order, CONTEXT).document().get("card"));
    }
}
