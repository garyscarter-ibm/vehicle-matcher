package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import gcsp.api.evidence.CanonicalJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class GeneratedStockInputsTest {
    private static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();
    private static final Path EVIDENCE = ROOT.resolve("server/data/gcsp/vehicle-evidence");
    private static final Instant CLOCK = Instant.parse("2026-11-05T09:00:00Z");

    private GeneratedStockInputs loader(Path corpus) {
        return new GeneratedStockInputs(corpus, EVIDENCE, ROOT,
                new PolicyService(new RetainedFilePolicySource(ROOT.resolve("server/gcsp/policy/seed-v1.json"), List.of())));
    }

    @Test
    void retainedCorpusProducesTheCanonicalBoundedPlanWithoutVinOrInventory() {
        JsonNode request = loader(EVIDENCE.resolve("demo-fleet.v1")).load("run-1", "gcsp-policy-v1", CLOCK, null, null);
        assertFalse(request.has("status"), request.toString());
        assertEquals(142, request.path("plan").path("configurations").size());
        assertEquals(142, request.path("configurations").size());
        assertEquals("gcsp-demo-stock-v1", request.path("seed").asText());
        assertFalse(request.has("inventory"));
        assertEquals(7, request.path("plan").path("aggregateKeys").size());
        request.path("configurations").forEach(configuration -> {
            assertFalse(configuration.path("extraFacts").path("configurationEvidence").path("value").path("identity").has("vin"));
            assertTrue(configuration.path("extraFacts").has("optionSelection"));
        });
    }

    @Test
    void missingCorpusAndUnresolvablePolicyAreExplicitlyUnavailable() {
        assertEquals("unavailable", loader(EVIDENCE.resolve("absent")).load("run-1", "gcsp-policy-v1", CLOCK, null, null).path("status").asText());
        assertEquals("unavailable", loader(EVIDENCE.resolve("demo-fleet.v1")).load("run-1", "missing-version", CLOCK, null, null).path("status").asText());
    }

    @Test
    void unknownGuaranteePrincipalIsUnavailable() throws Exception {
        JsonNode tranche = new ObjectMapper().readTree("{\"guarantee\":{\"principalId\":\"missing-person\",\"minimumCars\":1}}");
        assertEquals("release-guarantee-unavailable", loader(EVIDENCE.resolve("demo-fleet.v1"))
                .load("run-1", "gcsp-policy-v1", CLOCK, new ObjectMapper().createObjectNode(), tranche).path("code").asText());
    }

    @Test
    void everyInputFieldAndMainQualificationMatchTheIndependentNodeOracle() throws Exception {
        JsonNode oracle;
        try (var input = getClass().getResourceAsStream("/supply/generated-inputs-oracle.json")) {
            assertNotNull(input, "Regenerate with the offline supply baseline tool");
            oracle = new ObjectMapper().readTree(input);
        }
        for (JsonNode fixture : oracle.path("cases")) {
            for (var source : fixture.path("codeSources").properties()) {
                assertEquals(source.getValue().asText(), CanonicalJson.sha256Hex(Files.readAllBytes(ROOT.resolve(source.getKey()))), source.getKey());
            }
            JsonNode pins = fixture.path("pins");
            JsonNode request = loader(EVIDENCE.resolve("demo-fleet.v1")).load(pins.path("runId").asText(),
                    pins.path("policyVersion").asText(), Instant.parse(pins.path("clockInstant").asText()),
                    fixture.get("scenario"), fixture.get("tranche"));
            assertFalse(request.has("status"), request.toString());
            ObjectNode actualPins = request.deepCopy();
            actualPins.remove("configurations");
            assertEquals(CanonicalJson.canonical(pins), CanonicalJson.canonical(actualPins), "plan, pinned assumptions and qualifying IDs");
            assertEquals(fixture.path("configurationDigests").size(), request.path("configurations").size());
            for (var expected : fixture.path("configurationDigests").properties()) {
                assertEquals(expected.getValue().asText(), CanonicalJson.digest(request.path("configurations").path(expected.getKey())),
                        "record/active/images/extraFacts for " + expected.getKey());
            }
            assertEquals(fixture.path("requestDigest").asText(), CanonicalJson.digest(request), "complete request");
            for (var browse : fixture.path("browseFacts").properties()) {
                assertEquals(CanonicalJson.canonical(browse.getValue()), CanonicalJson.canonical(GeneratedStockBrowseFacts.forKey(browse.getKey())), browse.getKey());
            }
        }
    }

    @Test
    void selectionCompletenessRequiresLiteralBooleansAndStringSchemaVersion() throws Exception {
        ObjectMapper json = new ObjectMapper();
        ObjectNode record = (ObjectNode) json.readTree("""
                {"configurationId":"fixture-unbound","snapshotVersion":"fixture-v1",
                 "configuration":{"vgModelCode":"FIXTURE","agModelCode":"unmapped"},
                 "sourceContext":{"sourceRefs":[],"observedDate":"2026-11-05"},
                 "catalogue":{"schemaVersion":"2","equipment":{"selected":{"state":"known",
                   "options":[],"accessories":[],"factoryComplete":"true","accessoryCodesComplete":true}}}}
                """);
        ObjectNode details = (ObjectNode) json.readTree("""
                {"identity":{"configurationId":"fixture-unbound"},"resolved":{"configurationId":"fixture-unbound"},
                 "equipment":{"selected":{"state":"unknown"}},
                 "description":{"powertrain":{"transmission":{"state":"unknown"}}}}
                """);
        ObjectNode selected = (ObjectNode) record.path("catalogue").path("equipment").path("selected");
        assertFalse(GeneratedStockConfigurationFacts.extra(record, details, json.createObjectNode())
                .path("optionSelection").path("value").path("complete").asBoolean(), "string true cannot prove a complete selection");
        selected.put("factoryComplete", true);
        selected.put("accessoryCodesComplete", "true");
        assertFalse(GeneratedStockConfigurationFacts.extra(record, details, json.createObjectNode())
                .path("optionSelection").path("value").path("complete").asBoolean(), "accessory completeness also needs a literal boolean");
        selected.put("accessoryCodesComplete", true);
        ((ObjectNode) record.get("catalogue")).put("schemaVersion", 2);
        assertFalse(GeneratedStockConfigurationFacts.extra(record, details, json.createObjectNode())
                .path("optionSelection").path("value").path("complete").asBoolean(), "numeric schema version is not the source contract");
        ((ObjectNode) record.get("catalogue")).put("schemaVersion", "1");
        selected.put("complete", "true").put("completeness", "complete");
        JsonNode extra = GeneratedStockConfigurationFacts.extra(record, details, json.createObjectNode());
        assertFalse(extra.path("optionSelection").path("value").path("complete").asBoolean());
        assertFalse(extra.has("eligibilityModelKey"), "unbound evidence does not invent an eligible model");
        assertEquals("unknown", extra.path("gearbox").path("status").asText());
        assertTrue(extra.has("configurationEvidence"));
    }
}
