package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** A deployable offline-cards/1 reader over one bounded JSON file; an unreadable file fails every read. */
public final class OfflineCardFile implements OfflineCardReader {

    static final long MAX_BYTES = 8L * 1024 * 1024;
    private static final String EDITION = "offline-cards/1";

    private final JsonNode entries;
    private final String problem;

    public OfflineCardFile(Path file) {
        JsonNode loaded = null;
        String failed = null;
        try {
            if (Files.size(file) > MAX_BYTES) throw new IOException("Offline card file is too large");
            JsonNode root = StrictJson.parse(Files.readAllBytes(file), (int) Files.size(file));
            JsonNode list = root.get("entries");
            if (list == null || !list.isArray()) throw new IOException("Offline card file has no entries");
            for (JsonNode entry : list) {
                JsonNode key = entry.get("key");
                if (!Js.isObject(key) || !key.path("category").isTextual() || !key.path("token").isTextual()
                        || !entry.has("document")) throw new IOException("Offline card entry is malformed");
            }
            loaded = list;
        } catch (IOException | RuntimeException e) {
            failed = "unreadable";
        }
        this.entries = loaded;
        this.problem = failed;
    }

    @Override
    public OfflineResponse read(String category, String token, EvidenceContext context) {
        if (problem != null) throw new IllegalStateException("Offline card file is unavailable");
        ObjectNode document = new ObjectMapper().createObjectNode();
        document.put("edition", EDITION);
        document.put("result", "missing");
        JsonNode found = document;
        for (JsonNode entry : entries) {
            if (!category.equals(entry.get("key").get("category").textValue())
                    || !token.equals(entry.get("key").get("token").textValue())) continue;
            JsonNode entryContext = entry.get("context");
            if (Js.truthy(entryContext) && !Js.strictEquals(entryContext.get("runId"),
                    context == null || context.runId() == null ? null : new com.fasterxml.jackson.databind.node.TextNode(context.runId()))) {
                document.put("result", "mismatch");
            } else {
                found = entry.get("document");
            }
            break;
        }
        return new OfflineResponse(200, found.deepCopy());
    }
}
