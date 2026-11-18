package gcsp.api.policy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The reviewed definition sets the server may adopt, read from the classpath copies of server/gcsp/policy/reviewed.
 * A port of the validation in reviewed-definitions.js; the offer journey sets and the FUCQ-115 choice model set.
 */
public final class ReviewedDefinitions {

    public static final String OFFER_JOURNEY_SET = "offer-journey-v1";
    public static final String OFFER_JOURNEY_SUCCESSOR_SET = "offer-journey-v2";
    public static final String CHOICE_MODEL_SET = "fucq115-choice-model-v1";
    private static final String CHOICE_MODEL = "gcsp/policy/reviewed/fucq115-choice-model-v1.json";
    private static final String DECLINE = "gcsp/policy/reviewed/offer-decline-reasons-v1.json";
    private static final String FOLLOWUP = "gcsp/policy/reviewed/offer-followup-questions-v1.json";
    private static final String REENTRY = "gcsp/policy/reviewed/offer-declined-car-reentry-v1.json";
    private static final List<String> BUNDLE_KEYS = List.of("schemaVersion", "definitionSetId", "revision", "definitions",
            "digest");
    private static final List<String> ROW_KEYS = List.of("key", "value", "unit", "basis", "source", "sourceDate", "status");
    private static final Set<String> STATUSES = Set.of("assumed", "verified", "observed aggregate");
    private static final Pattern DIGEST = Pattern.compile("[a-f0-9]{64}");
    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).build();

    private ReviewedDefinitions() {
    }

    /** The validated set, or null when the id is not a reviewed set; a missing or invalid artifact is source-invalid. */
    public static ObjectNode get(String definitionSetId) throws PolicySourceException {
        if (CHOICE_MODEL_SET.equals(definitionSetId)) {
            return load(CHOICE_MODEL);
        }
        if (!OFFER_JOURNEY_SET.equals(definitionSetId) && !OFFER_JOURNEY_SUCCESSOR_SET.equals(definitionSetId)) {
            return null;
        }
        return offerJourney(definitionSetId);
    }

    /** The decline reasons and follow-up questions as one set; its digest is the one the Node server computes. */
    static ObjectNode offerJourney() throws PolicySourceException {
        return offerJourney(OFFER_JOURNEY_SET);
    }

    private static ObjectNode offerJourney(String definitionSetId) throws PolicySourceException {
        ObjectNode decline = load(DECLINE);
        ObjectNode followup = load(FOLLOWUP);
        ObjectNode set = JsonNodeFactory.instance.objectNode();
        set.put("schemaVersion", 1);
        set.put("definitionSetId", definitionSetId);
        set.put("revision", "1");
        ArrayNode definitions = set.putArray("definitions");
        decline.get("definitions").forEach(row -> definitions.add(row.deepCopy()));
        followup.get("definitions").forEach(row -> definitions.add(row.deepCopy()));
        if (OFFER_JOURNEY_SUCCESSOR_SET.equals(definitionSetId)) {
            load(REENTRY).get("definitions").forEach(row -> definitions.add(row.deepCopy()));
        }
        set.put("digest", CanonicalJson.digest(set));
        if (!valid(set)) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
        return set;
    }

    private static ObjectNode load(String resource) throws PolicySourceException {
        try (InputStream in = ReviewedDefinitions.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                throw new PolicySourceException(PolicySourceException.UNAVAILABLE);
            }
            JsonNode node = MAPPER.readTree(in);
            if (!valid(node)) {
                throw new PolicySourceException(PolicySourceException.INVALID);
            }
            return (ObjectNode) node;
        } catch (IOException e) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
    }

    /** Exact keys, bounded rows with unique keys, finite JSON, and a digest of everything but the digest. */
    static boolean valid(JsonNode bundle) {
        if (!only(bundle, BUNDLE_KEYS) || !bundle.get("schemaVersion").isIntegralNumber()
                || bundle.get("schemaVersion").asLong() != 1 || !text(bundle.get("definitionSetId"))
                || !text(bundle.get("revision")) || !bundle.get("definitions").isArray()
                || bundle.get("definitions").isEmpty() || bundle.get("definitions").size() > 100) {
            return false;
        }
        Set<String> keys = new HashSet<>();
        for (JsonNode row : bundle.get("definitions")) {
            if (!only(row, ROW_KEYS) || !text(row.get("key")) || !text(row.get("unit")) || !text(row.get("basis"))
                    || !text(row.get("source")) || !keys.add(row.get("key").textValue())
                    || !row.get("sourceDate").isTextual() || !PolicyTime.validDay(row.get("sourceDate").textValue())
                    || !row.get("status").isTextual() || !STATUSES.contains(row.get("status").textValue())) {
                return false;
            }
        }
        JsonNode digest = bundle.get("digest");
        if (!digest.isTextual() || !DIGEST.matcher(digest.textValue()).matches()) {
            return false;
        }
        ObjectNode body = ((ObjectNode) bundle).deepCopy();
        body.remove("digest");
        return CanonicalJson.digest(body).equals(digest.textValue());
    }

    private static boolean only(JsonNode node, List<String> keys) {
        if (node == null || !node.isObject() || node.size() != keys.size()) {
            return false;
        }
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            if (!keys.contains(names.next())) {
                return false;
            }
        }
        return true;
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && !node.textValue().isBlank() && node.textValue().length() <= 256;
    }
}
