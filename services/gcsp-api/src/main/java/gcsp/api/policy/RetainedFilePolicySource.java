package gcsp.api.policy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads the retained policy file(s): the classpath copy of server/gcsp/policy/seed-v1.json by default, or explicit
 * paths (the first plus retained ones). A successful load is kept; a failed one is retried on the next call.
 */
public final class RetainedFilePolicySource implements PolicySource {

    public static final String DEFAULT_RESOURCE = "gcsp/policy/seed-v1.json";
    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    private final List<Path> paths;
    private volatile List<JsonNode> snapshot;

    public RetainedFilePolicySource() {
        this.paths = null;
    }

    public RetainedFilePolicySource(Path filePath, List<Path> retainedFilePaths) {
        List<Path> all = new ArrayList<>();
        all.add(filePath);
        all.addAll(retainedFilePaths);
        this.paths = List.copyOf(all);
    }

    @Override
    public List<JsonNode> loadVersions(String runId) throws PolicySourceException {
        List<JsonNode> loaded = snapshot;
        if (loaded != null) {
            return loaded;
        }
        synchronized (this) {
            if (snapshot == null) {
                List<JsonNode> seeds = new ArrayList<>();
                if (paths == null) {
                    seeds.add(parse(readResource()));
                } else {
                    for (Path path : paths) {
                        seeds.add(parse(readFile(path)));
                    }
                }
                snapshot = List.copyOf(seeds);
            }
            return snapshot;
        }
    }

    private static String readFile(Path path) throws PolicySourceException {
        try {
            return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException e) {
            throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
        }
    }

    private static String readResource() throws PolicySourceException {
        ClassLoader loader = RetainedFilePolicySource.class.getClassLoader();
        try (InputStream in = loader.getResourceAsStream(DEFAULT_RESOURCE)) {
            if (in == null) {
                throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
        }
    }

    /** Decoded as text first so a leading byte-order mark is refused, as JSON.parse does. */
    private static JsonNode parse(String contents) throws PolicySourceException {
        if (contents.startsWith("\uFEFF")) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
        try {
            JsonNode node = MAPPER.readTree(contents);
            if (node == null || node.isMissingNode()) {
                throw new PolicySourceException(PolicySourceException.INVALID);
            }
            return node;
        } catch (IOException e) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
    }
}
