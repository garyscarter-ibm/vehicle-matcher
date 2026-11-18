package gcsp.api.comparison;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Loads and verifies the retained comparison envelopes exactly as the Node job does; a refusal carries a fixed reason. */
public final class RetainedComparisonResults {

    public static final String DEFAULT_RESOURCE = "gcsp/comparison/process-only.json";
    public static final String PROCESS_FORMAT = "gcsp-process-comparison-result-v1";
    public static final String EXPERIMENT_FORMAT = "gcsp-experiment-comparison-result-v1";
    public static final String CAVEAT = "Calculated fit is not observed satisfaction.";
    public static final String PROCESS_ID = "process-only";
    public static final List<String> EXPERIMENT_IDS = List.of("process-only", "order-mix", "points", "hold-sweep");

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    /** A verified result with its derived id and digest. */
    public record Retained(String resultId, String experimentId, String kind, Instant completedAt,
            String policyVersion, String digest, JsonNode result) {}

    /** A file that is not a result this version understands; the message never carries file contents. */
    public static final class Refused extends Exception {
        Refused(String reason) {
            super(reason, null, false, false);
        }
    }

    private RetainedComparisonResults() {}

    /** The bundled default (no files given) or each file; a refused file is reported and skipped, never fatal. */
    public static List<Retained> load(List<Path> files, Consumer<String> refused) {
        List<Retained> out = new ArrayList<>();
        if (files.isEmpty()) {
            try (InputStream in = RetainedComparisonResults.class.getClassLoader().getResourceAsStream(DEFAULT_RESOURCE)) {
                if (in == null) throw new Refused("The bundled result file is missing.");
                out.add(verify(parse(new String(in.readAllBytes(), StandardCharsets.UTF_8))));
            } catch (Refused e) {
                refused.accept(e.getMessage());
            } catch (IOException e) {
                refused.accept("The bundled result file could not be read.");
            }
            return out;
        }
        for (Path file : files) {
            try {
                out.add(verify(parse(new String(Files.readAllBytes(file), StandardCharsets.UTF_8))));
            } catch (Refused e) {
                refused.accept(e.getMessage());
            } catch (IOException | RuntimeException e) {
                refused.accept("A result file could not be read.");
            }
        }
        return out;
    }

    private static JsonNode parse(String text) throws Refused {
        try {
            JsonNode node = text.startsWith("\uFEFF") ? null : MAPPER.readTree(text);
            if (node == null || node.isMissingNode()) throw new Refused("A result file is not valid JSON.");
            return node;
        } catch (IOException e) {
            throw new Refused("A result file is not valid JSON.");
        }
    }

    /** The checks of the Node readComparisonResultFile, then the fields the store needs. */
    public static Retained verify(JsonNode envelope) throws Refused {
        String format = text(envelope.get("format"));
        boolean process = PROCESS_FORMAT.equals(format);
        if (!process && !EXPERIMENT_FORMAT.equals(format)) throw new Refused("The file has an unknown result format.");
        JsonNode result = envelope.get("result");
        if (result == null || !result.isObject() || !CanonicalJson.digest(result).equals(text(envelope.get("digest")))) {
            throw new Refused("The file has changed since it was written (its digest does not match).");
        }
        String experimentId = text(result.get("experimentId"));
        boolean understood = result.has("schemaVersion") && result.get("schemaVersion").isNumber()
                && result.get("schemaVersion").doubleValue() == 1 && CAVEAT.equals(text(result.get("caveat")))
                && (process
                        ? "process-comparison".equals(text(result.get("kind"))) && PROCESS_ID.equals(experimentId)
                        : "experiment-comparison".equals(text(result.get("kind")))
                                && EXPERIMENT_IDS.contains(experimentId) && !PROCESS_ID.equals(experimentId));
        if (!understood) throw new Refused("The file does not hold a comparison result this version understands.");
        JsonNode manifest = result.get("manifest");
        JsonNode rows = result.get(process ? "perSeed" : "arms");
        Instant completedAt;
        try {
            completedAt = Instant.parse(text(result.get("completedAt")));
        } catch (RuntimeException e) {
            throw new Refused("The result has no valid completion time.");
        }
        if (manifest == null || !manifest.isObject() || text(manifest.get("policyVersion")) == null
                || rows == null || !rows.isArray() || (!process && rows.isEmpty())) {
            throw new Refused("The result is missing required fields.");
        }
        String resultId = resultId(process, experimentId, result);
        return new Retained(resultId, experimentId, text(result.get("kind")), completedAt,
                text(manifest.get("policyVersion")), text(envelope.get("digest")), result);
    }

    /** The stored id: kind prefix plus the digest of completion time, manifest and rows. Shared by import and runs. */
    static String resultId(boolean process, String experimentId, JsonNode result) {
        ObjectNode idInput = MAPPER.createObjectNode();
        idInput.set("completedAt", result.get("completedAt"));
        idInput.set("manifest", result.get("manifest"));
        idInput.set(process ? "perSeed" : "arms", result.get(process ? "perSeed" : "arms"));
        return (process ? "process-comparison-" : experimentId + "-comparison-")
                + CanonicalJson.digest(idInput).substring(0, 32);
    }

    /** A freshly run result as the store keeps it: verified like an imported envelope, with its own digest. */
    public static Retained ofRun(JsonNode result) throws Refused {
        ObjectNode envelope = MAPPER.createObjectNode();
        boolean process = result != null && "process-comparison".equals(text(result.get("kind")));
        envelope.put("format", process ? PROCESS_FORMAT : EXPERIMENT_FORMAT);
        envelope.put("digest", CanonicalJson.digest(result));
        envelope.set("result", result);
        return verify(envelope);
    }

    private static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }
}
