package gcsp.api.learning;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.util.List;
import java.util.regex.Pattern;

/** Port of model/artifact.js: a verified, digest-pinned choice-model artifact (read-only once built). */
public final class ModelArtifact {

    public static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final Pattern SHA = Pattern.compile("^sha256:[a-f0-9]{64}$");
    private static final Pattern HEX64 = Pattern.compile("^[a-f0-9]{64}$");
    private static final List<String> BASELINES = List.of("learned", "expressedDemand", "deterministicFit");
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(JsonParser.Feature.AUTO_CLOSE_SOURCE)
            .build();

    private final String artifactId;
    private final ObjectNode payload;
    private final double[] coefficients;

    private ModelArtifact(String artifactId, ObjectNode payload, double[] coefficients) {
        this.artifactId = artifactId;
        this.payload = payload;
        this.coefficients = coefficients;
    }

    public String artifactId() {
        return artifactId;
    }

    /** The verified payload; callers must not mutate it. */
    public ObjectNode payload() {
        return payload;
    }

    public double[] coefficients() {
        return coefficients.clone();
    }

    public String featureVersion() {
        return payload.get("featureVersion").textValue();
    }

    public static boolean validId(String id) {
        return id != null && SHA.matcher(id).matches();
    }

    private static boolean text(JsonNode v) {
        return v != null && v.isTextual() && !v.textValue().isEmpty();
    }

    private static boolean nonNegative(JsonNode v) {
        return Js.finite(v) && v.doubleValue() >= 0;
    }

    private static String canonical(JsonNode node) {
        try {
            return CanonicalJson.canonical(node);
        } catch (IllegalArgumentException e) {
            throw new ChoiceModelException(ChoiceModelException.INVALID, "artifact.json");
        }
    }

    /** createModelArtifact: validates the payload and derives the artifact id from its canonical digest. */
    public static ModelArtifact create(JsonNode input) {
        String canonicalText = canonical(input);
        ChoiceModelException.require(Js.isObject(input) && jsonNumber(input.get("schemaVersion"), 1)
                && Js.isString(input.get("modelVersion"), "conditional-logit.l2.v1")
                && Js.isText(input.get("featureVersion")) && ChoiceFeatures.known(input.get("featureVersion").textValue()),
                "artifact.version");
        ObjectNode payload = (ObjectNode) input;
        List<String> expected = ChoiceFeatures.FEATURE_SETS.get(payload.get("featureVersion").textValue());
        JsonNode names = payload.get("featureNames");
        JsonNode coefficientNodes = payload.get("coefficients");
        boolean coefficientsOk = names != null && names.isArray() && namesEqual(names, expected)
                && coefficientNodes != null && coefficientNodes.isArray() && coefficientNodes.size() == expected.size();
        if (coefficientsOk) {
            for (JsonNode c : coefficientNodes) coefficientsOk &= Js.finite(c);
        }
        ChoiceModelException.require(coefficientsOk, "artifact.coefficients");
        JsonNode provenance = payload.get("provenance");
        JsonNode seed = Js.get(provenance, "seed");
        ChoiceModelException.require(text(payload.get("policyVersion")) && Js.truthy(payload.get("trainingSettings"))
                && Js.truthy(payload.get("trainingManifest")) && Js.truthy(payload.get("partition"))
                && Js.truthy(payload.get("evaluation")) && nonEmptyArray(payload.get("limitations"))
                && Js.isString(Js.get(provenance, "label"), "synthetic-trained") && text(provenance.get("generatorVersion"))
                && (text(seed) || Js.safeInteger(seed)) && nonEmptyArray(provenance.get("assumptions")), "artifact.provenance");
        JsonNode manifest = payload.get("trainingManifest");
        JsonNode counts = Js.get(payload.get("partition"), "counts");
        ChoiceModelException.require(jsonNumber(Js.get(manifest, "schemaVersion"), 1)
                && Js.isString(Js.get(manifest, "datasetKind"), "synthetic") && Js.isText(Js.get(manifest, "dataHash"))
                && HEX64.matcher(manifest.get("dataHash").textValue()).matches()
                && Js.strictEquals(Js.get(manifest, "generatorVersion"), provenance.get("generatorVersion"))
                && Js.strictEquals(Js.get(manifest, "seed"), seed)
                && Js.safeInteger(Js.get(Js.get(manifest, "counts"), "records"))
                && Js.get(manifest, "counts").get("records").doubleValue() > 0, "artifact.manifest");
        boolean partitionOk = true;
        for (String key : List.of("training", "later", "unseen", "familiar")) {
            JsonNode n = Js.get(counts, key);
            partitionOk &= Js.safeInteger(n) && n.doubleValue() > 0;
        }
        ChoiceModelException.require(partitionOk && counts.get("unseen").doubleValue() + counts.get("familiar").doubleValue()
                == counts.get("later").doubleValue(), "artifact.partition");
        for (String key : BASELINES) {
            JsonNode report = Js.get(Js.get(payload.get("evaluation"), "models"), key);
            JsonNode overall = Js.get(report, "overall");
            boolean ok = overall != null && Js.strictEquals(overall.get("count"), counts.get("later"))
                    && nonNegative(overall.get("logLoss")) && nonNegative(overall.get("brier")) && overall.get("brier").doubleValue() <= 2
                    && isArray(report.get("byCohort")) && isArray(report.get("byVehicleClass")) && isArray(report.get("reliability"))
                    && text(Js.get(report.get("provenance"), "source")) && text(Js.get(report.get("provenance"), "version"));
            ChoiceModelException.require(ok, "artifact.evaluation." + key);
        }
        double[] coefficients = new double[coefficientNodes.size()];
        for (int i = 0; i < coefficients.length; i++) coefficients[i] = coefficientNodes.get(i).doubleValue();
        String id = "sha256:" + CanonicalJson.sha256Hex(canonicalText.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new ModelArtifact(id, payload, coefficients);
    }

    /** verifyModelArtifact: the envelope holds exactly artifactId and payload, and the id is the payload digest. */
    public static ModelArtifact verify(JsonNode envelope) {
        ChoiceModelException.require(Js.isObject(envelope) && envelope.size() == 2 && envelope.has("payload"), "artifact.envelope");
        ModelArtifact expected = create(envelope.get("payload"));
        ChoiceModelException.require(Js.isString(envelope.get("artifactId"), expected.artifactId), "artifact.digest",
                ChoiceModelException.CORRUPT);
        return expected;
    }

    /** readModelArtifact after the file bytes are in hand: size cap, strict JSON, verification, id pinned. */
    public static ModelArtifact parse(byte[] bytes, String expectedId) {
        try {
            ChoiceModelException.require(validId(expectedId), "artifact.path");
            ChoiceModelException.require(bytes.length <= MAX_BYTES, "artifact.size");
            boolean bom = bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF;
            if (bom) throw new IOException("BOM");
            ModelArtifact artifact = verify(MAPPER.readTree(bytes));
            ChoiceModelException.require(artifact.artifactId.equals(expectedId), "artifact.reference", ChoiceModelException.CORRUPT);
            return artifact;
        } catch (ChoiceModelException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw new ChoiceModelException(ChoiceModelException.UNAVAILABLE, "artifact");
        }
    }

    private static boolean jsonNumber(JsonNode node, double value) {
        return node != null && node.isNumber() && node.doubleValue() == value;
    }

    private static boolean isArray(JsonNode node) {
        return node != null && node.isArray();
    }

    private static boolean nonEmptyArray(JsonNode node) {
        return isArray(node) && node.size() > 0;
    }

    private static boolean namesEqual(JsonNode names, List<String> expected) {
        if (names.size() != expected.size()) return false;
        for (int i = 0; i < expected.size(); i++) if (!Js.isString(names.get(i), expected.get(i))) return false;
        return true;
    }

    /** evaluationSummary: a deliberate allowlist projection; record ids and training rows stay out. */
    public ObjectNode evaluationSummary() {
        JsonNode models = payload.get("evaluation").get("models");
        ObjectNode metrics = JSON.objectNode();
        for (String key : BASELINES) {
            JsonNode result = models.get(key);
            ObjectNode projected = metrics.putObject(key);
            for (String field : List.of("overall", "byCohort", "byVehicleClass", "reliability", "provenance")) {
                projected.set(field, result.get(field).deepCopy());
            }
        }
        JsonNode provenance = payload.get("provenance");
        ObjectNode summary = JSON.objectNode();
        summary.put("schemaVersion", 1);
        summary.put("status", "evaluated");
        summary.put("artifactId", artifactId);
        summary.set("policyVersion", payload.get("policyVersion").deepCopy());
        summary.set("featureVersion", payload.get("featureVersion").deepCopy());
        summary.put("label", "Offline evaluation");
        summary.set("partitionCounts", payload.get("partition").get("counts").deepCopy());
        summary.set("metrics", metrics);
        JsonNode deltas = payload.get("evaluation").get("deltas");
        if (deltas != null) summary.set("deltas", deltas.deepCopy());
        summary.set("limitations", (ArrayNode) payload.get("limitations").deepCopy());
        ObjectNode origin = summary.putObject("trainingOrigin");
        origin.set("label", provenance.get("label").deepCopy());
        origin.set("generatorVersion", provenance.get("generatorVersion").deepCopy());
        origin.set("seed", provenance.get("seed").deepCopy());
        origin.set("assumptions", provenance.get("assumptions").deepCopy());
        return summary;
    }
}
