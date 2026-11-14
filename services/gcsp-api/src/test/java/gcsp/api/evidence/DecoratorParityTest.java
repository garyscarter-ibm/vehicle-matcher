package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The decorated Java lookup must equal Node's production createLocalVehicleEvidenceLookup. */
class DecoratorParityTest {

    private static final List<String> STORES = List.of("lookup-reference.v1", "demo-fleet.v1", "fleet-source.v1");

    @Test
    void decoratedDigestsMatchNodeForEveryConfigurationAndVin() throws Exception {
        JsonNode golden = EvidenceFixtures.golden("s3-digests.json");
        DisplayCatalogue catalogue = DecoratorFixtures.catalogue();
        ConfigurationDefinitions definitions = new ConfigurationDefinitions(DecoratorFixtures.SEED);
        assertTrue(catalogue.available() && definitions.available());
        long started = System.nanoTime();
        int configurations = 0;
        int vins = 0;
        int representative = 0;
        for (String name : STORES) {
            VehicleEvidenceLookup lookup = DecoratorFixtures.lookup(name, catalogue, definitions);
            JsonNode expected = golden.get(name);
            List<String> ids = configurationIds(name);
            assertEquals(expected.get("idsDigest").textValue(),
                    CanonicalJson.digest(EvidenceFixtures.MAPPER.valueToTree(ids)), name + " row order");
            assertEquals(expected.get("configurations").size(), ids.size(), name);
            int storeRepresentative = 0;
            for (int i = 0; i < ids.size(); i++) {
                ObjectNode result = lookup.resolve(new EvidenceRequest("configuration", ids.get(i), null), null);
                assertEquals(expected.get("configurations").get(i).textValue(), CanonicalJson.digest(result),
                        name + " configuration " + ids.get(i));
                if ("representative".equals(result.get("images").get("state").textValue())) storeRepresentative++;
                configurations++;
            }
            for (JsonNode vin : expected.get("vins")) {
                ObjectNode result = lookup.resolve(new EvidenceRequest("vin", vin.get("vin17").textValue(), null), null);
                assertEquals(vin.get("digest").textValue(), CanonicalJson.digest(result), name + " vin " + vin.get("vin17"));
                if ("representative".equals(result.get("images").get("state").textValue())) storeRepresentative++;
                vins++;
            }
            assertEquals(expected.get("counts").get("representative").intValue(), storeRepresentative, name + " representative");
            representative += storeRepresentative;
        }
        long ms = (System.nanoTime() - started) / 1_000_000;
        // Node resolved the same sequence on one shared index, so the diagnostics counters must agree too.
        assertNull(LookupCases.diff("$", golden.get("definitionStatusAfter"), definitions.definitionStatus()));
        System.out.println("s3 decorated parity configs=" + configurations + " vins=" + vins
                + " representative=" + representative + " ms=" + ms);
    }

    @Test
    void fullDecoratedResultsAndDefinitionStatusEqualNode() {
        JsonNode golden = EvidenceFixtures.golden("s3-full.json");
        ConfigurationDefinitions definitions = new ConfigurationDefinitions(DecoratorFixtures.SEED);
        assertNull(LookupCases.diff("$", golden.get("definitionStatus"), definitions.definitionStatus()), "fresh status");
        DisplayCatalogue catalogue = DecoratorFixtures.catalogue();
        JsonNode cases = golden.get("cases");
        assertTrue(cases.size() >= 5, "case count");
        for (JsonNode entry : cases) {
            VehicleEvidenceLookup lookup = DecoratorFixtures.lookup(entry.get("store").textValue(), catalogue, definitions);
            ObjectNode actual = lookup.resolve(new EvidenceRequest(entry.get("kind").textValue(), entry.get("id").textValue(), null), null);
            String name = entry.get("name").textValue();
            assertNull(LookupCases.diff("$", entry.get("result"), actual), name);
        }
    }

    @Test
    void imagesOnlyDecoratorMatchesNodeWithoutDefinitions() {
        JsonNode expected = EvidenceFixtures.golden("s3-full.json").get("imagesOnlyFleetDigests");
        DisplayCatalogue catalogue = DecoratorFixtures.catalogue();
        VehicleEvidenceLookup lookup = DecoratorFixtures.lookup("fleet-source.v1", catalogue, null);
        List<String> ids = fleetIds(expected.size());
        for (int i = 0; i < ids.size(); i++) {
            ObjectNode result = lookup.resolve(new EvidenceRequest("configuration", ids.get(i), null), null);
            assertEquals(expected.get(i).textValue(), CanonicalJson.digest(result), "fleet configuration " + i);
        }
    }

    @Test
    void decoratorsNeverMutateTheInnerSource() {
        CorpusStore store = LookupCases.store("fleet-source.v1");
        EvidenceRegistry inner = EvidenceRegistry.of(store);
        EvidenceRegistry stack = DecoratorFixtures.stack(inner, DecoratorFixtures.catalogue(),
                new ConfigurationDefinitions(DecoratorFixtures.SEED));
        String id = fleetIds(1).get(0);
        String before = CanonicalJson.canonical(inner.getConfiguration(id).record());
        EvidenceSource decorated = stack.getConfiguration(id);
        ((ObjectNode) decorated.record()).put("tampered", true);
        assertEquals(before, CanonicalJson.canonical(inner.getConfiguration(id).record()));
        assertEquals(before, CanonicalJson.canonical(store.getConfiguration(id).record()));
    }

    private static List<String> fleetIds(int count) {
        List<String> ids = configurationIdsUnchecked("fleet-source.v1");
        return ids.subList(0, Math.min(count, ids.size()));
    }

    private static List<String> configurationIdsUnchecked(String store) {
        try {
            return configurationIds(store);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    static List<String> configurationIds(String store) throws Exception {
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
