package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GeneratedStockGeneratorTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path ROOT = Path.of("../..").toAbsolutePath().normalize();
    private static final String ORACLE = "services/gcsp-api/tools/supply-baseline/generate.mjs";

    @TempDir Path dir;

    @Test
    void nativeRowsReportAndInventoryExactlyMatchNodeForPinnedMainRun() throws Exception {
        compare("main", inputs("main-successful-journey", "native-generator-main"));
    }

    @Test
    void oneWeekLeadUsesTheHorizonEndAndMatchesAllNodeRows() throws Exception {
        ObjectNode request = inputs("none", "native-generator-horizon");
        request.put("clockInstant", "2026-11-06T10:00:00.000Z");
        for (JsonNode key : request.path("plan").path("aggregateKeys")) {
            ((ObjectNode) request.path("assumptions").path(key.asText()).path("value")).set("leadTimeWeeks",
                    JSON.createObjectNode().put("min", 1).put("max", 1));
        }
        JsonNode value = compare("horizon", request);
        JsonNode windows = value.path("report").path("release").path("windows");
        Instant lastRelease = Instant.parse(windows.path(windows.size() - 1).asText());
        assertTrue(!value.path("rows").isEmpty());
        for (JsonNode row : value.path("rows")) {
            JsonNode facts = row.path("facts").path("facts");
            assertEquals(1, facts.path("leadTimeWeeks").path("value").asInt());
            assertTrue(Instant.parse(facts.path("confirmedDeliveryWeek").path("value").asText() + "T00:00:00.000Z").isAfter(lastRelease));
        }
    }

    @Test
    void guaranteeSubstitutionsMatchNodeAndSupplyDistinctQualifyingColoursInEveryTranche() throws Exception {
        ObjectNode request = inputs("none", "native-generator-guarantee");
        String qualifyingLine = null;
        for (JsonNode key : request.path("plan").path("aggregateKeys")) {
            String line = request.path("assumptions").path(key.asText()).path("value").path("modelLineId").asText();
            Set<String> colours = new HashSet<>();
            for (JsonNode binding : request.path("plan").path("configurations")) if (line.equals(binding.path("modelLineId").asText())) colours.add(binding.path("colour").asText());
            if (colours.size() >= 2) { qualifyingLine = line; break; }
        }
        assertTrue(qualifyingLine != null, "Retained input must cover two qualifying colours");
        ObjectNode mix = JSON.createObjectNode();
        String drawnLine = null;
        for (var names = request.path("plan").path("aggregateKeys").fieldNames(); names.hasNext();) {
            String line = names.next(); mix.put(line, 0);
            if (!line.equals(qualifyingLine)) drawnLine = line;
        }
        assertTrue(drawnLine != null, "Retained input must cover an alternative model line");
        mix.put(drawnLine, 1);
        ObjectNode mixRow = JSON.createObjectNode().put("key", "supply.release.modelMix"); mixRow.set("value", mix);
        ((ObjectNode) request.path("assumptions")).set("supply.release.modelMix", mixRow);
        ObjectNode guarantee = request.putObject("guarantee").put("principalId", "engine-guarantee").put("minimumCars", 2);
        guarantee.putArray("distinct").add("colour");
        ArrayNode qualified = request.putArray("qualifyingConfigurationIds");
        Set<String> qualifyingIds = new HashSet<>();
        for (JsonNode binding : request.path("plan").path("configurations")) if (qualifyingLine.equals(binding.path("modelLineId").asText())) {
            qualified.add(binding.path("configurationId")); qualifyingIds.add(binding.path("configurationId").asText());
        }
        JsonNode value = compare("guarantee", request);
        assertTrue(value.path("report").path("release").path("guarantee").path("substituted").asInt() > 0);
        var colours = new java.util.HashMap<String, Set<String>>();
        for (JsonNode row : value.path("rows")) {
            String tranche = row.path("facts").path("facts").path("plannedRelease").path("value").path("releaseId").asText();
            Set<String> held = colours.computeIfAbsent(tranche, ignored -> new HashSet<>());
            if (qualifyingIds.contains(row.path("configurationId").asText())) {
                String colour = "";
                for (JsonNode binding : request.path("plan").path("configurations")) if (binding.path("configurationId").equals(row.path("configurationId"))) colour = binding.path("colour").asText();
                held.add(colour);
            }
        }
        assertTrue(!colours.isEmpty() && colours.values().stream().allMatch(c -> c.size() >= 2));
    }

    @Test
    void retainedIdentityCollisionsAndUnchangedReuseMatchTheCompleteNodeInventory() throws Exception {
        ObjectNode request = inputs("none", "native-generator-collisions");
        JsonNode initial = compare("initial", request);
        ObjectNode inventory = initial.path("inventory").deepCopy();
        ArrayNode records = (ArrayNode) inventory.path("records");
        ObjectNode displaced = records.get(0).deepCopy();
        String target = displaced.path("vehicleId").asText();
        String oldUuid = displaced.path("orderUuid").asText(), oldNumber = displaced.path("orderNumber").asText();
        int oldWholesaler = displaced.path("wholesalerOrderId").asInt();
        records.remove(0);
        ((ObjectNode) records.get(0)).put("orderNumber", oldNumber);
        displaced.put("runId", "retained-other-run").put("vehicleId", "retained-other-car");
        records.add(displaced);
        inventory.remove("contentDigest"); inventory.put("contentDigest", CanonicalJson.digest(inventory));
        request.set("inventory", inventory);
        JsonNode collided = compare("collisions", request);
        JsonNode allocated = null;
        boolean preserved = false;
        for (JsonNode row : collided.path("inventory").path("records")) {
            if (row.path("runId").asText().equals("retained-other-run")) preserved = row.equals(displaced);
            if (row.path("runId").equals(request.path("runId")) && row.path("vehicleId").asText().equals(target)) allocated = row;
        }
        assertTrue(preserved && allocated != null);
        assertTrue(!oldUuid.equals(allocated.path("orderUuid").asText()));
        assertTrue(!oldNumber.equals(allocated.path("orderNumber").asText()));
        assertTrue(oldWholesaler != allocated.path("wholesalerOrderId").asInt());
        request.set("inventory", collided.path("inventory").deepCopy());
        JsonNode replay = compare("reuse", request);
        assertTrue(collided.path("inventory").equals(replay.path("inventory")),
                () -> difference(collided.path("inventory"), replay.path("inventory"), "inventory"));
        assertTrue(collided.path("rows").equals(replay.path("rows")),
                () -> difference(collided.path("rows"), replay.path("rows"), "rows"));
    }

    @Test
    void largeSafeIntegerAggregateCountsMatchTheCompleteNodeReport() throws Exception {
        ObjectNode request = inputs("none", "native-generator-large-count");
        for (JsonNode key : request.path("plan").path("aggregateKeys")) {
            ((ObjectNode) request.path("assumptions").path(key.asText()).path("value")).put("carCount", 3000000000L);
        }
        compare("large-count", request);
    }

    @Test
    void aGuaranteeBeyondTheIntegerRangeIsRefusedLikeNodeBeforeAnyDraw() throws Exception {
        ObjectNode request = inputs("none", "native-generator-large-guarantee");
        ObjectNode guarantee = request.putObject("guarantee").put("principalId", "engine-guarantee").put("minimumCars", 4294967296L);
        guarantee.putArray("distinct").add("colour");
        JsonNode expected = oracle("large-guarantee", request);
        assertEquals("invalid", expected.path("status").asText());
        assertEquals("unsupported-release-guarantee", expected.path("code").asText());
        JsonNode actual = GeneratedStockGenerator.generate(request);
        assertEquals(expected.path("status"), actual.path("status"));
        assertEquals(expected.path("code"), actual.path("code"));
    }

    private ObjectNode inputs(String scenario, String runId) throws Exception {
        Path path = dir.resolve("inputs.json");
        node("inputs", "--generated-inputs", path.toString(), scenario, runId);
        return (ObjectNode) JSON.readTree(path.toFile());
    }

    private JsonNode compare(String label, ObjectNode request) throws Exception {
        JsonNode expected = oracle(label, request);
        assertEquals("ok", expected.path("status").asText(), expected.path("code").asText());
        JsonNode actual = GeneratedStockGenerator.generate(request);
        assertEquals("ok", actual.path("status").asText(), actual.toString());
        assertTrue(expected.path("value").equals(actual.path("value")),
                () -> difference(expected.path("value"), actual.path("value"), "value"));
        return expected.path("value");
    }

    private JsonNode oracle(String label, ObjectNode request) throws Exception {
        Path requestFile = dir.resolve(label + "-request.json");
        JSON.writeValue(requestFile.toFile(), request);
        Path output = dir.resolve(label + "-expected.json");
        node(label, "--generated-request", requestFile.toString(), output.toString(), dir.resolve(label + "-inventory.json").toString());
        JsonNode expected = JSON.readTree(output.toFile());
        request.set("inventory", expected.get("inputInventory"));
        return expected;
    }

    private void node(String label, String... args) throws Exception {
        List<String> command = new ArrayList<>(List.of("node", ORACLE));
        command.addAll(List.of(args));
        Path log = dir.resolve(label + ".log");
        Process process = new ProcessBuilder(command).directory(ROOT.toFile()).redirectErrorStream(true)
                .redirectOutput(log.toFile()).start();
        boolean finished = process.waitFor(90, TimeUnit.SECONDS);
        if (!finished) { process.destroyForcibly(); process.waitFor(); }
        assertTrue(finished, "Node oracle exceeded 90 seconds: " + log);
        assertEquals(0, process.exitValue(), "Node oracle failed: " + log);
    }

    private static String difference(JsonNode expected, JsonNode actual, String path) {
        if (expected.equals(actual)) return "equal";
        if (expected.isContainerNode() && expected.getNodeType() == actual.getNodeType()) {
            if (expected.size() != actual.size()) return path + " size expected " + expected.size() + " actual " + actual.size();
            if (expected.isArray()) {
                for (int i = 0; i < expected.size(); i++) if (!expected.path(i).equals(actual.path(i))) return difference(expected.path(i), actual.path(i), path + "[" + i + "]");
            } else {
                for (var fields = expected.fieldNames(); fields.hasNext();) {
                    String field = fields.next();
                    if (!expected.path(field).equals(actual.path(field))) return difference(expected.path(field), actual.path(field), path + "." + field);
                }
            }
        }
        return path + " expected " + shortValue(expected) + " actual " + shortValue(actual);
    }

    private static String shortValue(JsonNode value) {
        String text = value.toString();
        return text.substring(0, Math.min(text.length(), 240)) + " (" + value.getClass().getSimpleName() + ")";
    }
}
