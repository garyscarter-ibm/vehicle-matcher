package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.CorpusResults.Classification;
import gcsp.api.evidence.CorpusResults.ConfigurationResult;
import gcsp.api.evidence.CorpusResults.VinResult;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Java load() and per-id results must equal what Node's registry produced for the same stores. */
class CorpusStoreGoldenTest {

    private static final JsonNode GOLDEN = EvidenceFixtures.golden("s1-stores.json");

    @Test
    void everyFixtureStoreMatchesNode() {
        assertTrue(GOLDEN.get("fixtures").size() >= 12);
        for (Iterator<Map.Entry<String, JsonNode>> it = GOLDEN.get("fixtures").fields(); it.hasNext(); ) {
            var entry = it.next();
            Path root = EvidenceFixtures.required(EvidenceFixtures.RESOURCES.resolve("stores").resolve(entry.getKey()));
            assertMatches(entry.getKey(), new CorpusStore(root.toAbsolutePath()), entry.getValue());
        }
    }

    @Test
    void lookupReferenceStoreMatchesNode() {
        real("lookup-reference.v1");
    }

    @Test
    void demoFleetStoreMatchesNode() {
        real("demo-fleet.v1");
    }

    @Test
    void fleetSourceStoreMatchesNodeAndReportsLoadCost() {
        System.gc();
        long before = used();
        long started = System.nanoTime();
        CorpusStore store = real("fleet-source.v1");
        long millis = (System.nanoTime() - started) / 1_000_000;
        System.gc();
        long heapDeltaMb = Math.round((used() - before) / (1024.0 * 1024.0));
        System.out.println("fleet-source load ms=" + millis + " heapDeltaMB=" + heapDeltaMb + " configs="
                + store.status().active().counts().get("configurations").asInt());
    }

    private static long used() {
        Runtime runtime = Runtime.getRuntime();
        return runtime.totalMemory() - runtime.freeMemory();
    }

    private static CorpusStore real(String name) {
        Path root = EvidenceFixtures.required(EvidenceFixtures.REAL.resolve(name)).toAbsolutePath();
        CorpusStore store = new CorpusStore(root);
        assertMatches(name, store, GOLDEN.get("real").get(name));
        return store;
    }

    private static void assertMatches(String name, CorpusStore store, JsonNode expected) {
        LoadOutcome load = store.load();
        JsonNode readiness = expected.get("readiness");
        JsonNode loadGolden = expected.get("load");
        boolean ready = "ready".equals(readiness.get("status").textValue());
        assertEquals(ready, load.ready(), name + " readiness");
        assertEquals(readiness.get("recovered").booleanValue(), load.recovered(), name + " recovered");
        assertEquals(nullable(readiness.get("manifestDigest")), load.active() == null ? null : load.active().manifestDigest(), name);
        if (!ready) assertEquals(readiness.get("code").textValue(), load.failure().code(), name + " readiness code");
        assertEquals(loadGolden.get("status").textValue(), load.status(), name + " load status");
        assertEquals(nullable(loadGolden.get("code")), load.failure() == null ? null : load.failure().code(), name + " load code");
        assertEquals(nullable(loadGolden.get("causeCode")), load.failure() == null ? null : load.failure().cause(), name + " cause");
        if (!loadGolden.get("changed").isNull()) assertTrue(load.failure().historyChanged(), name + " history changed");
        assertActive(name, loadGolden.get("active"), load.active());
        assertEquals(expected.get("registryStatus").get("status").textValue(), store.status().status(), name);
        assertActive(name, expected.get("registryStatus").get("active"), store.status().active());
        JsonNode ids = expected.get("ids");
        JsonNode checks = expected.get("checks");
        String config = ids.get("configurationId").textValue();
        String last = ids.get("lastConfigurationId").isNull() ? config : ids.get("lastConfigurationId").textValue();
        String vin17 = ids.get("vin17").textValue();
        configuration(name, checks.get("configurationKnown"), store.getConfiguration(config));
        configuration(name, checks.get("configurationLast"), store.getConfiguration(last));
        configuration(name, checks.get("configurationUnknown"), store.getConfiguration("no-such-configuration"));
        configuration(name, checks.get("configurationInvalid"), store.getConfiguration(""));
        vin(name, checks.get("vin17Known"), store.getVin(vin17));
        vin(name, checks.get("vin7Known"), store.getVin(vin17.substring(10)));
        vin(name, checks.get("vinUnknown"), store.getVin("WBA33DB08TC499999"));
        vin(name, checks.get("vin7Unknown"), store.getVin("C499999"));
        vin(name, checks.get("vinInvalid"), store.getVin("abc"));
        classification(name, checks.get("classifyConfigurationKnown"), store.classifyConfiguration(config));
        classification(name, checks.get("classifyConfigurationUnknown"), store.classifyConfiguration("no-such-configuration"));
        classification(name, checks.get("classifyIdentityKnown"), store.classifyIdentity(vin17));
        classification(name, checks.get("classifyIdentityVin7"), store.classifyIdentity(vin17.substring(10)));
        classification(name, checks.get("classifyIdentityUnknown"), store.classifyIdentity("WBA33DB08TC499999"));
    }

    private static void assertActive(String name, JsonNode golden, ActiveInfo actual) {
        if (golden.isNull()) {
            assertEquals(null, actual, name + " active");
            return;
        }
        assertEquals(golden.get("datasetId").textValue(), actual.datasetId(), name);
        assertEquals(golden.get("version").textValue(), actual.version(), name);
        assertEquals(golden.get("manifestDigest").textValue(), actual.manifestDigest(), name);
        assertEquals(CanonicalJson.canonical(golden.get("counts")), CanonicalJson.canonical(actual.counts()), name + " counts");
    }

    private static void configuration(String name, JsonNode golden, ConfigurationResult actual) {
        String label = name + " " + golden;
        assertEquals(golden.get("status").textValue(), actual.status(), label);
        assertEquals(nullable(golden.get("code")), actual.failure() == null ? null : actual.failure().code(), label);
        assertEquals(nullable(golden.get("sourceKind")), actual.sourceKind(), label);
        assertEquals(nullable(golden.get("imageState")), actual.imageState(), label);
        assertEquals(golden.get("imageCount").isNull() ? null : golden.get("imageCount").asInt(),
                actual.images() == null ? null : actual.images().size(), label);
        assertEquals(nullable(golden.get("recordDigest")), actual.record() == null ? null : CanonicalJson.digest(actual.record()), label);
        assertEquals(nullable(golden.get("supplementDigest")),
                actual.technicalSupplement() == null ? null : CanonicalJson.digest(actual.technicalSupplement()), label);
        assertEquals(nullable(golden.get("activeManifestDigest")), actual.active() == null ? null : actual.active().manifestDigest(), label);
    }

    private static void vin(String name, JsonNode golden, VinResult actual) {
        String label = name + " " + golden;
        assertEquals(golden.get("status").textValue(), actual.status(), label);
        assertEquals(nullable(golden.get("code")), actual.failure() == null ? null : actual.failure().code(), label);
        assertEquals(nullable(golden.get("identityKind")), actual.identityKind(), label);
        assertEquals(golden.get("liveEligible").isNull() ? null : golden.get("liveEligible").booleanValue(), actual.liveEligible(), label);
        assertEquals(nullable(golden.get("vehicleDigest")), actual.vehicle() == null ? null : CanonicalJson.digest(actual.vehicle()), label);
        assertEquals(nullable(golden.get("recordDigest")),
                actual.configuration() == null || actual.configuration().record() == null ? null
                        : CanonicalJson.digest(actual.configuration().record()), label);
        assertEquals(nullable(golden.get("activeManifestDigest")), actual.active() == null ? null : actual.active().manifestDigest(), label);
    }

    private static void classification(String name, JsonNode golden, Classification actual) {
        String label = name + " " + golden;
        assertEquals(golden.get("status").textValue(), actual.status(), label);
        assertEquals(nullable(golden.get("code")), actual.failure() == null ? null : actual.failure().code(), label);
        assertEquals(nullable(golden.get("identityKind")), actual.identityKind(), label);
        assertEquals(false, actual.liveEligible(), label);
        assertEquals(nullable(golden.get("vehicleId")), actual.vehicleId(), label);
        assertEquals(nullable(golden.get("configurationId")), actual.configurationId(), label);
        assertEquals(nullable(golden.get("originatingDatasetId")), actual.originatingDatasetId(), label);
    }

    private static String nullable(JsonNode node) {
        return node == null || node.isNull() ? null : node.textValue();
    }
}
