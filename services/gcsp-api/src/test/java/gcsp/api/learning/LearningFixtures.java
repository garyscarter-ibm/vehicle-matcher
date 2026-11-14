package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Shared test access to the retained seed, the retained artifact and the Node parity cases. */
final class LearningFixtures {

    static final ObjectMapper MAPPER = new ObjectMapper();
    static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    static final Path ARTIFACTS = Path.of("../../docs/gcsp/models/artifacts");
    static final Path CASES = Path.of("src/test/resources/learning-parity/cases.json");
    static final String ID = "sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d";
    static final String FILE_SHA256 = "a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86";

    private LearningFixtures() {}

    static JsonNode read(Path path) {
        try {
            return MAPPER.readTree(Files.readAllBytes(path));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static ObjectNode seed() {
        return (ObjectNode) read(SEED);
    }

    static Path retainedFile() {
        return ARTIFACTS.resolve(ID.substring(7) + ".json");
    }

    static ObjectNode reference(String artifactId, String featureVersion, int schemaVersion) {
        ObjectNode value = MAPPER.createObjectNode();
        value.put("artifactId", artifactId);
        value.put("schemaVersion", schemaVersion);
        value.put("featureVersion", featureVersion);
        return value;
    }

    /** A reference row as the parity generator builds it. */
    static ObjectNode referenceRow(JsonNode value) {
        ObjectNode seed = seed();
        ObjectNode row = MAPPER.createObjectNode();
        row.put("key", "choice.model.reference");
        row.set("value", value);
        row.put("unit", "test-fixture");
        row.put("status", "assumed");
        row.put("basis", "Test activation of a synthetic-trained artifact.");
        row.put("source", "LearningFixtures");
        row.put("sourceDate", "2026-11-09");
        row.set("policyVersion", seed.get("policyVersion"));
        row.set("effectiveFrom", seed.get("effectiveFrom"));
        return row;
    }

    /** A PolicyService over the seed with the generator's named edits applied. */
    static PolicyService service(JsonNode spec) {
        ObjectNode source = seed();
        ArrayNode assumptions = (ArrayNode) source.get("assumptions");
        JsonNode referenceRow = spec == null ? null : spec.get("referenceRow");
        if (referenceRow != null && !referenceRow.isNull()) assumptions.add(referenceRow.deepCopy());
        ObjectNode settings = null;
        for (JsonNode row : assumptions) if ("forecast.learned.v1".equals(row.get("key").textValue())) settings = (ObjectNode) row;
        if (spec != null && spec.path("removeSettings").asBoolean(false)) {
            for (int i = assumptions.size() - 1; i >= 0; i--) if (assumptions.get(i) == settings) assumptions.remove(i);
        } else if (spec != null && spec.has("settingsValue")) {
            settings.set("value", spec.get("settingsValue").deepCopy());
        }
        List<JsonNode> versions = List.of(source);
        return new PolicyService(runId -> versions);
    }

    /** The artifact directories the cases name: the retained one, and the derived/tampered/truncated ones in dir. */
    static Map<String, Path> artifactDirectories(JsonNode retainedMeta, Path dir) throws IOException {
        Map<String, Path> dirs = new HashMap<>();
        dirs.put("retained", ARTIFACTS);
        String fileText = Files.readString(retainedFile(), StandardCharsets.UTF_8);
        JsonNode retained = MAPPER.readTree(fileText);
        var it = retainedMeta.get("derived").fields();
        while (it.hasNext()) {
            var entry = it.next();
            JsonNode spec = entry.getValue();
            Path sub = Files.createDirectory(dir.resolve(entry.getKey()));
            dirs.put(entry.getKey(), sub);
            ObjectNode payload = (ObjectNode) retained.get("payload").deepCopy();
            for (JsonNode edit : spec.get("edits")) set(payload, edit.get("pointer").textValue(), edit.get("value"));
            String name = spec.get("artifactId").textValue().substring(7) + ".json";
            switch (spec.get("mode").textValue()) {
                case "derived" -> {
                    ModelArtifact artifact = ModelArtifact.create(payload);
                    ObjectNode envelope = MAPPER.createObjectNode().put("artifactId", artifact.artifactId());
                    envelope.set("payload", payload);
                    Files.writeString(sub.resolve(name), CanonicalJson.canonical(envelope) + "\n");
                }
                case "tampered" -> {
                    ObjectNode envelope = MAPPER.createObjectNode().put("artifactId", ID);
                    envelope.set("payload", payload);
                    Files.writeString(sub.resolve(name), MAPPER.writeValueAsString(envelope) + "\n");
                }
                default -> Files.writeString(sub.resolve(name), fileText.substring(0, 1500));
            }
        }
        return dirs;
    }

    private static void set(JsonNode root, String pointer, JsonNode value) {
        String[] parts = pointer.substring(1).split("/");
        JsonNode at = root;
        for (int i = 0; i < parts.length - 1; i++) at = at.isArray() ? at.get(Integer.parseInt(parts[i])) : at.get(parts[i]);
        String last = parts[parts.length - 1];
        if (at.isArray()) ((ArrayNode) at).set(Integer.parseInt(last), value.deepCopy());
        else ((ObjectNode) at).set(last, value.deepCopy());
    }
}
