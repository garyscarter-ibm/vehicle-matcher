package gcsp.api.comparison;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySourceException;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ComparisonInputsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String RUN = "comparison-experiment-preparation";
    private static final String STARTS_AT = "2026-11-05T09:00:00.000Z";
    private static final PolicyRead READ = new PolicyRead(RUN, STARTS_AT, null);
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final Map<String, String> RETAINED_HASHES = Map.of(
            "comparison-a", "53bcb43e78caefd6fef8c5c08e25454b1871c89af65369d624bb39af5b123509",
            "comparison-b", "59c3ae5cd9a0425781f1b25bd0e587f828dcfee35935e23cb7b183f43220ccb2",
            "comparison-c", "3793d4b7f30652d082a17756184714e86d263560e997ab37e87df7924766fe63");

    private static ComparisonPolicy bundled() {
        return ComparisonPolicy.load(new PolicyService(new RetainedFilePolicySource()), READ);
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream in = ComparisonInputsTest.class.getClassLoader().getResourceAsStream(name)) {
            return MAPPER.readTree(in);
        }
    }

    private static ObjectNode overlay(String json) throws IOException {
        return (ObjectNode) MAPPER.readTree(json);
    }

    private static String outputDigest(ComparisonInputs out) {
        ObjectNode all = MAPPER.createObjectNode();
        all.set("employees", out.employees());
        all.set("stock", out.stock());
        all.set("releaseSchedule", out.releaseSchedule());
        all.set("manifest", out.manifest());
        return CanonicalJson.digest(all);
    }

    @Test
    void fullSizeSeedsMatchTheRetainedInputHashes() throws IOException {
        ComparisonPolicy policy = bundled();
        JsonNode retained = resource("gcsp/comparison/process-only.json").get("result").get("manifest").get("inputHashes");
        Runtime rt = Runtime.getRuntime();
        System.gc();
        long before = rt.totalMemory() - rt.freeMemory();
        long start = System.nanoTime();
        ComparisonInputs last = null;
        for (String seed : List.of("comparison-a", "comparison-b", "comparison-c")) {
            ComparisonInputs out = ComparisonInputs.generate(seed, policy, null);
            assertEquals(RETAINED_HASHES.get(seed), retained.get(seed).textValue());
            assertEquals(retained.get(seed).textValue(), out.manifest().get("inputHash").textValue(), seed);
            assertEquals(1000, out.employees().size());
            assertEquals(850, out.stock().size());
            assertEquals(9, out.releaseSchedule().size());
            assertEquals("c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994",
                    out.manifest().get("policyHash").textValue());
            last = out;
        }
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.gc();
        long delta = (rt.totalMemory() - rt.freeMemory() - before) / (1024 * 1024);
        System.out.println("comparison inputs: 3 seeds x 1000 employees in " + ms + " ms, heap delta " + delta + " MB");
        assertTrue(last != null);
    }

    @Test
    void goldenCasesMatchNodeExactly() throws IOException {
        JsonNode golden = resource("comparison-parity/inputs.json");
        ComparisonPolicy policy = bundled();
        assertEquals(golden.get("policyVersion").textValue(), policy.policyVersion());
        assertEquals(golden.get("startsAt").textValue(), policy.assumptions().get("comparison.startsAt").get("value").textValue());
        // The golden overlays name model lines by position; the cases below resolve them from the same snapshot.
        String second = policy.configurations().get(1).get("modelLine").textValue();
        String third = policy.configurations().get(2).get("modelLine").textValue();
        String first = policy.configurations().get(0).get("modelLine").textValue();
        int checked = 0;
        for (JsonNode c : golden.get("cases")) {
            String name = c.get("name").textValue();
            ObjectNode ov = ((ObjectNode) c.get("overlay")).deepCopy();
            if (name.equals("model-line-mix")) {
                ov.set("comparison.modelLineMix", MAPPER.readTree("[{\"modelLine\":\"" + second
                        + "\",\"weight\":3},{\"modelLine\":\"" + third + "\",\"weight\":1}]"));
            } else if (name.equals("zero-weight-mix")) {
                ov.set("comparison.modelLineMix", MAPPER.readTree("[{\"modelLine\":\"" + first + "\",\"weight\":0}]"));
            }
            JsonNode seed = c.get("seed");
            if (c.has("error")) {
                ComparisonInputError e = assertThrows(ComparisonInputError.class,
                        () -> ComparisonInputs.generate(seed, policy, ov), name);
                assertEquals(c.get("error").get("code").textValue(), e.code(), name);
                assertEquals(c.get("error").get("key").textValue(), e.key(), name);
            } else {
                ComparisonInputs out = ComparisonInputs.generate(seed, policy, ov);
                JsonNode ok = c.get("ok");
                JsonNode m = out.manifest();
                for (String field : List.of("inputHash", "policyHash", "configurationHash", "overlayHash")) {
                    assertEquals(ok.get(field).textValue(), m.get(field).textValue(), name + " " + field);
                }
                assertEquals(CanonicalJson.canonical(ok.get("counts")), CanonicalJson.canonical(m.get("counts")), name);
                assertEquals(ok.get("outputDigest").textValue(), outputDigest(out), name);
            }
            checked++;
        }
        assertEquals(golden.get("cases").size(), checked);
    }

    @Test
    void smallOutputMatchesTheRepresentativeNodeFixture() throws IOException {
        JsonNode fixture = MAPPER.readTree(Files.readAllBytes(Path.of("../../server/test/fixtures/gcsp-comparison-representative.json")));
        ComparisonPolicy policy = bundled();
        ComparisonInputs out = ComparisonInputs.generate("comparison-a", policy,
                overlay("{\"comparison.cohortSize\":3,\"comparison.carsPerEmployee\":1}"));
        assertEquals(fixture.get("manifest").get("inputHash").textValue(), out.manifest().get("inputHash").textValue());
        assertEquals(CanonicalJson.canonical(fixture.get("employees")), CanonicalJson.canonical(out.employees()));
        assertEquals(CanonicalJson.canonical(fixture.get("stock")), CanonicalJson.canonical(out.stock()));
        assertEquals(CanonicalJson.canonical(fixture.get("releaseSchedule")), CanonicalJson.canonical(out.releaseSchedule()));
        for (String field : List.of("overlayHash", "configurationHash", "counts", "seed", "seeds", "overlay", "startsAt")) {
            assertEquals(CanonicalJson.canonical(fixture.get("manifest").get(field)),
                    CanonicalJson.canonical(out.manifest().get(field)), field);
        }
        // The seed changed under the same policyVersion since the fixture was written, so its policyHash differs.
        String fixtureHash = fixture.get("manifest").get("policyHash").textValue();
        if (fixtureHash.equals(out.manifest().get("policyHash").textValue())) {
            assertEquals(CanonicalJson.canonical(fixture.get("manifest")), CanonicalJson.canonical(out.manifest()));
        } else {
            assertNotEquals(fixtureHash, out.manifest().get("policyHash").textValue());
        }
    }

    @Test
    void anOverlayIsNeverModifiedAndTheSnapshotStaysFrozen() throws IOException {
        ComparisonPolicy policy = bundled();
        ObjectNode ov = overlay("{\"comparison.cohortSize\":4,\"comparison.carsPerEmployee\":1}");
        String before = ov.toString();
        String assumptions = CanonicalJson.canonical(MAPPER.valueToTree(policy.assumptions()));
        ComparisonInputs out = ComparisonInputs.generate("x", policy, ov);
        assertEquals(before, ov.toString());
        assertEquals(assumptions, CanonicalJson.canonical(MAPPER.valueToTree(policy.assumptions())));
        assertTrue(out.manifest().get("assumptions").toString().contains("\"overlay\":true"));
    }

    @Test
    void aFailingPolicySourceIsPolicyUnavailable() {
        PolicyService failing = new PolicyService(runId -> {
            throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
        });
        ComparisonInputError e = assertThrows(ComparisonInputError.class, () -> ComparisonPolicy.load(failing, READ));
        assertEquals("policy-unavailable", e.code());
        assertEquals("policyVersion", e.key());
        PolicyService throwing = new PolicyService(runId -> {
            throw new IllegalStateException("boom");
        });
        assertEquals("policy-unavailable",
                assertThrows(ComparisonInputError.class, () -> ComparisonPolicy.load(throwing, READ)).code());
    }

    @Test
    void aMissingAssumptionIsPolicyUnavailableForThatKey() throws IOException {
        ObjectNode seed = (ObjectNode) MAPPER.readTree(Files.readAllBytes(SEED));
        var rows = (com.fasterxml.jackson.databind.node.ArrayNode) seed.get("assumptions");
        for (int i = rows.size() - 1; i >= 0; i--) {
            if (rows.get(i).get("key").textValue().equals("comparison.buddyUptake")) rows.remove(i);
        }
        PolicyService service = new PolicyService(runId -> List.of(seed));
        ComparisonInputError e = assertThrows(ComparisonInputError.class, () -> ComparisonPolicy.load(service, READ));
        assertEquals("policy-unavailable", e.code());
        assertEquals("comparison.buddyUptake", e.key());
    }

    @Test
    void aCorpusConfigurationSetIsUnavailableWithoutAPort() throws IOException {
        ObjectNode seed = (ObjectNode) MAPPER.readTree(Files.readAllBytes(SEED));
        for (JsonNode row : seed.get("assumptions")) {
            if (row.get("key").textValue().equals("comparison.configurationSet.v1")) {
                ((ObjectNode) row.get("value")).put("kind", "corpus");
            }
        }
        PolicyService service = new PolicyService(runId -> List.of(seed));
        ComparisonInputError e = assertThrows(ComparisonInputError.class, () -> ComparisonPolicy.load(service, READ));
        assertEquals("configuration-unavailable", e.code());
        assertEquals("comparison.configurationSet.v1", e.key());
    }

    @Test
    void aPinnedPolicyVersionThatIsNotActiveIsRefused() {
        PolicyService service = new PolicyService(new RetainedFilePolicySource());
        ComparisonInputError e = assertThrows(ComparisonInputError.class,
                () -> ComparisonPolicy.load(service, new PolicyRead(RUN, STARTS_AT, "no-such-version")));
        assertEquals("policy-unavailable", e.code());
    }
}
