package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicySource;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Test fixtures: the retained seed policy with the generator's named edits applied, written under a test directory. */
final class PolicyFiles {

    static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path dir;
    private final String name;

    PolicyFiles(Path dir, String name) {
        this.dir = dir;
        this.name = name.replace('/', '_');
    }

    static ObjectNode seed() throws IOException {
        return (ObjectNode) MAPPER.readTree(Files.readAllBytes(SEED));
    }

    static ObjectNode row(JsonNode assumptions, String key) {
        for (JsonNode a : assumptions) {
            if (a.get("key").textValue().equals(key)) {
                return (ObjectNode) a;
            }
        }
        throw new IllegalStateException(key);
    }

    /** Applies remove, set and patch operations (as the Node generators do) to the seed. */
    static ObjectNode edited(JsonNode ops) throws IOException {
        ObjectNode seed = seed();
        for (JsonNode op : ops) {
            ArrayNode assumptions = (ArrayNode) seed.get("assumptions");
            switch (op.get("op").textValue()) {
                case "remove" -> {
                    ArrayNode kept = MAPPER.createArrayNode();
                    for (JsonNode a : assumptions) {
                        if (!a.get("key").textValue().startsWith(op.get("prefix").textValue())) {
                            kept.add(a);
                        }
                    }
                    seed.set("assumptions", kept);
                }
                case "set" -> row(assumptions, op.get("key").textValue()).set("value", op.get("value"));
                case "patch" -> {
                    JsonNode target = row(assumptions, op.get("key").textValue()).get("value");
                    JsonNode path = op.get("path");
                    for (int i = 0; i < path.size() - 1; i++) {
                        target = path.get(i).isInt() ? target.get(path.get(i).intValue()) : target.get(path.get(i).textValue());
                    }
                    JsonNode last = path.get(path.size() - 1);
                    if (last.isInt()) {
                        ((ArrayNode) target).set(last.intValue(), op.get("value"));
                    } else {
                        ((ObjectNode) target).set(last.textValue(), op.get("value"));
                    }
                }
                default -> throw new IllegalStateException(op.toString());
            }
        }
        return seed;
    }

    /** A file source over the edited seed. */
    PolicySource source(JsonNode ops) throws IOException {
        Path file = dir.resolve(name + ".json");
        Files.writeString(file, edited(ops).toString());
        return new RetainedFilePolicySource(file, List.of());
    }
}
