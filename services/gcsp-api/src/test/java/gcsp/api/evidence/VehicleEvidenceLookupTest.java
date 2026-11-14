package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.LookupCases.StockCounts;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The Java lookup must return exactly what Node's undecorated lookup returned for the same inputs. */
class VehicleEvidenceLookupTest {

    private static final String REF_CONFIG = "UkVGMTpSRUZFUkVOQ0U=";
    private static final String REF_VIN = "WBA33DB08TC426611";

    @Test
    void fullResultsEqualNode() {
        JsonNode cases = EvidenceFixtures.golden("s2-full.json").get("cases");
        assertTrue(cases.size() > 100, "case count");
        for (JsonNode entry : cases) check(entry, new StockCounts());
    }

    @Test
    void stockResultsEqualNodeWithTheSameCallSequence() {
        JsonNode cases = EvidenceFixtures.golden("s2-stock.json").get("cases");
        assertTrue(cases.size() > 50, "case count");
        for (JsonNode entry : cases) {
            StockCounts counts = new StockCounts();
            check(entry, counts);
            if (entry.has("calls")) {
                assertEquals(entry.get("calls").get("currentRun").asInt(), counts.currentRun, entry.get("name").textValue() + " run lookups");
                assertEquals(entry.get("calls").get("read").asInt(), counts.read, entry.get("name").textValue() + " stock reads");
            }
        }
    }

    private static void check(JsonNode entry, StockCounts counts) {
        String name = entry.get("name").textValue();
        ObjectNode actual = LookupCases.run(entry, counts);
        if (entry.has("result")) {
            String diff = LookupCases.diff("$", entry.get("result"), actual);
            assertNull(diff, name + " -> " + diff);
        } else {
            assertEquals(entry.get("resultStatus").textValue(), actual.get("status").textValue(), name);
            assertEquals(entry.get("resultDigest").textValue(), CanonicalJson.digest(actual), name + " digest");
        }
        assertEquals(EvidenceFailures.httpStatus(actual.get("status").textValue()), EvidenceFailures.httpStatus(actual), name);
    }

    @Test
    void failuresNeverReflectTheRequestedId() {
        EvidenceRegistry registry = EvidenceRegistry.of(LookupCases.store("lookup-reference.v1"));
        VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(registry, null);
        for (EvidenceRequest request : List.of(new EvidenceRequest("vin", "ZZZZZZZZ0ZZ000000", null),
                new EvidenceRequest("vin", "private-looking-text", null),
                new EvidenceRequest("configuration", "UNKNOWN", null))) {
            ObjectNode result = lookup.resolve(request, null);
            assertTrue(result.get("requested").get("id").isNull(), result.toString());
            assertTrue(result.get("identity").isNull());
            assertTrue(!result.toString().contains(request.id()), "reflected id");
        }
    }

    @Test
    void failureStatusesMapToHttpNumbers() {
        Map<String, Integer> expected = Map.of("complete", 200, "partial", 200, "invalid-input", 400, "not-found", 404,
                "source-unavailable", 503, "unsupported", 422, "identity-mismatch", 409);
        expected.forEach((status, number) -> assertEquals(number, EvidenceFailures.httpStatus(status), status));
        assertEquals(503, EvidenceFailures.httpStatus((String) null));
        assertEquals(503, EvidenceFailures.httpStatus("unheard-of"));
        assertEquals(503, EvidenceFailures.httpStatus((JsonNode) null));
    }

    @Test
    void mutatingAResultDoesNotChangeTheNext() {
        VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(EvidenceRegistry.of(LookupCases.store("lookup-reference.v1")), null);
        EvidenceRequest request = new EvidenceRequest("configuration", REF_CONFIG, null);
        String before = CanonicalJson.canonical(lookup.resolve(request, null));
        ObjectNode first = lookup.resolve(request, null);
        first.with("technical").with("seats").put("state", "tampered");
        first.with("source").withArray("references").removeAll();
        first.with("description").with("model").with("provenance").put("kind", "tampered");
        first.with("equipment").put("selected", "tampered");
        first.put("status", "tampered");
        assertEquals(before, CanonicalJson.canonical(lookup.resolve(request, null)));
        ObjectNode vin = lookup.resolve(new EvidenceRequest("vin", REF_VIN, null), null);
        ((ObjectNode) vin.get("source")).put("market", "tampered");
        assertNotEquals("tampered", lookup.resolve(new EvidenceRequest("vin", REF_VIN, null), null).get("source").get("market").asText());
    }

    @Test
    void mutatingTheRegistryRecordThroughAResultIsImpossible() {
        CorpusStore store = LookupCases.store("fleet-source.v1");
        VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(EvidenceRegistry.of(store), null);
        EvidenceRequest request = new EvidenceRequest("configuration", REF_CONFIG, null);
        String before = CanonicalJson.canonical(store.getConfiguration(REF_CONFIG).record());
        ObjectNode result = lookup.resolve(request, null);
        result.with("description").put("model", "tampered");
        result.with("source").withArray("references").removeAll();
        assertEquals(before, CanonicalJson.canonical(store.getConfiguration(REF_CONFIG).record()));
    }

    @Test
    void corpusDigestsMatchNodeForEveryConfigurationAndVin() throws Exception {
        JsonNode golden = EvidenceFixtures.golden("s2-digests.json");
        long started = System.nanoTime();
        int configurations = 0;
        int vins = 0;
        for (String name : List.of("lookup-reference.v1", "demo-fleet.v1", "fleet-source.v1")) {
            CorpusStore store = LookupCases.store(name);
            VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(EvidenceRegistry.of(store), null);
            JsonNode expected = golden.get(name);
            List<String> ids = configurationIds(name);
            assertEquals(expected.get("idsDigest").textValue(),
                    CanonicalJson.digest(EvidenceFixtures.MAPPER.valueToTree(ids)), name + " row order");
            assertEquals(expected.get("configurations").size(), ids.size(), name);
            for (int i = 0; i < ids.size(); i++) {
                ObjectNode result = lookup.resolve(new EvidenceRequest("configuration", ids.get(i), null), null);
                assertEquals(expected.get("configurations").get(i).textValue(), CanonicalJson.digest(result),
                        name + " configuration " + ids.get(i));
                configurations++;
            }
            for (JsonNode vin : expected.get("vins")) {
                ObjectNode result = lookup.resolve(new EvidenceRequest("vin", vin.get("vin17").textValue(), null), null);
                assertEquals(vin.get("digest").textValue(), CanonicalJson.digest(result), name + " vin " + vin.get("vin17"));
                vins++;
            }
        }
        assertNotNull(golden);
        System.out.println("s2 corpus parity configs=" + configurations + " vins=" + vins
                + " ms=" + (System.nanoTime() - started) / 1_000_000);
    }

    private static List<String> configurationIds(String store) throws Exception {
        Path dir = EvidenceFixtures.REAL.resolve(store);
        String digest = EvidenceFixtures.MAPPER.readTree(Files.readAllBytes(dir.resolve("active.json")))
                .get("selected").get("manifestDigest").textValue();
        List<String> ids = new ArrayList<>();
        try (var lines = Files.lines(dir.resolve("versions").resolve(digest).resolve("configurations.jsonl"))) {
            lines.filter(line -> !line.isEmpty()).forEach(line -> {
                try {
                    ids.add(EvidenceFixtures.MAPPER.readTree(line).get("configurationId").textValue());
                } catch (java.io.IOException e) {
                    throw new java.io.UncheckedIOException(e);
                }
            });
        }
        return ids;
    }
}
