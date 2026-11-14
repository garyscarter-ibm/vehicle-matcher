package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * Selected-option definitions ported from Node configuration-definitions.js. The seed is pinned by sha256 and
 * compiled once into exact-context and selected-code maps; an absent or changed seed is explicitly unavailable.
 */
public final class ConfigurationDefinitions {

    public static final String SEED_SHA256 = "7327f922585d0a5eabe5dca00363bc2f2e7ed29816c9c91bb17a304beddab939";

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final long MAX_SEED_BYTES = 2L * 1024 * 1024;
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    private record Variant(JsonNode source, String market, JsonNode vgModelCode, JsonNode generations,
            JsonNode agModelCodes, JsonNode sources, Map<String, JsonNode> definitions) {}

    private final Map<String, Variant> variants = new HashMap<>();
    private final AtomicLong resolutions = new AtomicLong();
    private final ObjectNode identity = F.objectNode();
    private final JsonNode population;
    private final boolean available;

    /** A missing, oversized, changed or malformed seed leaves the index unavailable, never partially trusted. */
    public ConfigurationDefinitions(Path seedFile) {
        boolean ok = false;
        JsonNode seed = null;
        try {
            if (Files.size(seedFile) > MAX_SEED_BYTES) throw new IOException("definition-seed-changed");
            byte[] bytes = Files.readAllBytes(seedFile);
            if (bytes.length > MAX_SEED_BYTES || !CanonicalJson.sha256Hex(bytes).equals(SEED_SHA256)) {
                throw new IOException("definition-seed-changed");
            }
            seed = StrictJson.parse(bytes, bytes.length);
            compile(seed);
            identity.put("version", seed.get("version").textValue());
            identity.put("digest", SEED_SHA256);
            ok = true;
        } catch (IOException | RuntimeException e) {
            variants.clear();
        }
        this.available = ok;
        this.population = ok ? seed.get("population") : null;
    }

    private void compile(JsonNode seed) {
        JsonNode list = seed.get("variants");
        if (!Js.is(seed.get("schemaVersion"), "1") || !text(seed.get("version")) || list == null || !list.isArray()
                || list.size() > 1000) throw invalid();
        for (JsonNode variant : list) {
            if (!text(variant.get("source")) || variants.containsKey(variant.get("source").textValue())
                    || !text(variant.get("market")) || !text(variant.get("vgModelCode"))
                    || !isArray(variant.get("generations")) || !isArray(variant.get("agModelCodes"))
                    || !isArray(variant.get("sources")) || !Js.isObject(variant.get("definitions"))
                    || variant.get("definitions").size() > 512) throw invalid();
            Map<String, JsonNode> definitions = new HashMap<>();
            var fields = variant.get("definitions").fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                validDefinition(entry.getKey(), entry.getValue(), variant.get("sources"));
                definitions.put(entry.getKey(), entry.getValue().deepCopy());
            }
            variants.put(variant.get("source").textValue(), new Variant(variant.get("source").deepCopy(),
                    variant.get("market").textValue(), variant.get("vgModelCode").deepCopy(),
                    variant.get("generations").deepCopy(), variant.get("agModelCodes").deepCopy(),
                    variant.get("sources").deepCopy(), definitions));
        }
    }

    private static void validDefinition(String code, JsonNode definition, JsonNode sources) {
        JsonNode candidates = Js.field(definition, "candidates");
        JsonNode state = Js.field(definition, "state");
        if (!text(code) || !(Js.is(state, "known") || Js.is(state, "unknown")) || !isArray(candidates)) throw invalid();
        for (JsonNode candidate : candidates) {
            JsonNode label = Js.field(candidate, "label");
            JsonNode refs = Js.field(candidate, "sources");
            if (!text(label) || label.textValue().length() > 512 || !text(Js.field(candidate, "category"))
                    || !isArray(refs) || refs.isEmpty()) throw invalid();
            for (JsonNode index : refs) {
                JsonNode source = index.isNumber() && index.doubleValue() == Math.rint(index.doubleValue())
                        && index.doubleValue() >= 0 && index.doubleValue() < sources.size()
                        ? sources.get((int) index.doubleValue()) : null;
                JsonNode date = Js.field(source, "observedDate");
                if (!Js.truthy(source) || date == null || !date.isTextual() || !DATE.matcher(date.textValue()).matches()) {
                    throw invalid();
                }
            }
        }
        if (Js.is(state, "known") != (candidates.size() == 1)) throw invalid();
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Invalid definition seed.");
    }

    private static boolean isArray(JsonNode node) {
        return node != null && node.isArray();
    }

    /** Node text() in this module: a non-blank string of at most 8192 characters. */
    private static boolean text(String value) {
        return value != null && !VehicleIdentifiers.jsTrim(value).isEmpty() && value.length() <= 8192;
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && text(node.textValue());
    }

    public boolean available() {
        return available;
    }

    /** Node definitionStatus(). Counts every resolve since construction, as the Node index does. */
    public JsonNode definitionStatus() {
        ObjectNode status = F.objectNode();
        if (!available) {
            status.put("status", "source-unavailable");
            status.put("reason", "definition-seed-unavailable");
            return status;
        }
        status.put("status", "ok");
        status.put("version", identity.get("version").textValue());
        status.put("digest", identity.get("digest").textValue());
        if (population != null) status.set("coverage", population.deepCopy());
        ObjectNode diagnostics = status.putObject("diagnostics");
        diagnostics.put("indexBuilds", 1);
        diagnostics.put("variants", variants.size());
        diagnostics.put("resolutions", resolutions.get());
        diagnostics.put("lookup", "exact-context-and-selected-code-maps");
        return status;
    }

    /** The decorated source for a registry result; sources without a record are returned unchanged. */
    EvidenceSource enrich(EvidenceSource source) {
        if (source == null || source.record() == null || !Js.truthy(source.record())) return source;
        ObjectNode resolution = available ? resolve(source.record()) : unavailable(source.record());
        JsonNode record = source.record().deepCopy();
        JsonNode equipment = Js.field(Js.field(record, "catalogue"), "equipment");
        if (Js.truthy(equipment)) {
            JsonNode existing = equipment.get("definitions") == null || equipment.get("definitions").isNull()
                    ? F.arrayNode() : equipment.get("definitions");
            if (!existing.isArray()) throw new IllegalStateException("definitions is not a list");
            Set<JsonNode> selected = new LinkedHashSet<>();
            JsonNode options = Js.field(selectedCodes(source.record()), "options");
            if (options != null && !options.isNull()) {
                if (!options.isArray()) throw new IllegalStateException("options is not a list");
                options.forEach(selected::add);
            }
            Map<JsonNode, JsonNode> joined = new LinkedHashMap<>();
            for (JsonNode definition : existing) {
                if (definition == null || definition.isNull()) throw new IllegalStateException("definition is null");
                joined.put(codeKey(definition), definition);
            }
            for (JsonNode definition : resolution.withArray("definitions")) {
                if (selected.contains(definition.get("code"))) joined.put(codeKey(definition), definition);
            }
            ArrayNode merged = F.arrayNode();
            joined.values().forEach(merged::add);
            ((ObjectNode) equipment).set("definitions", merged);
        }
        ObjectNode metadata = resolution.deepCopy();
        metadata.remove("definitions");
        List<JsonNode> images = null;
        if (source.images() != null) {
            images = new ArrayList<>();
            for (JsonNode image : source.images()) images.add(image.deepCopy());
        }
        return new EvidenceSource(source.status(), source.active(), record, copy(source.vehicle()),
                copy(source.technicalSupplement()), images, metadata);
    }

    private static JsonNode copy(JsonNode node) {
        return node == null ? null : node.deepCopy();
    }

    private static JsonNode codeKey(JsonNode definition) {
        JsonNode code = Js.field(definition, "code");
        return code == null ? MissingNode.getInstance() : code;
    }

    private static JsonNode selectedCodes(JsonNode record) {
        return Js.field(Js.field(Js.field(record, "catalogue"), "equipment"), "selected");
    }

    private static int selectedCount(JsonNode selected) {
        JsonNode options = Js.field(selected, "options");
        if (options == null) return 0;
        if (options.isArray()) return options.size();
        return options.isTextual() ? options.textValue().length() : 0;
    }

    private ObjectNode base(JsonNode record) {
        ObjectNode base = F.objectNode();
        if (available) {
            base.put("version", identity.get("version").textValue());
            base.put("digest", identity.get("digest").textValue());
        } else {
            base.putNull("version");
            base.putNull("digest");
        }
        JsonNode id = Js.field(record, "configurationId");
        if (id != null || available) base.set("configurationId", id == null ? F.nullNode() : id.deepCopy());
        base.put("claim", "selected-catalogue-equipment");
        base.put("verifiedFitted", "unknown");
        base.put("swatches", "unknown");
        return base;
    }

    private ObjectNode unavailable(JsonNode record) {
        ObjectNode node = base(record);
        node.put("state", "unknown");
        node.put("reason", "definition-seed-unavailable");
        node.put("selectedCount", selectedCount(selectedCodes(record)));
        node.put("resolvedCount", 0);
        node.putArray("unresolved");
        node.putArray("definitions");
        return node;
    }

    /** Node resolve(): exact variant context, then selected-code lookups. */
    ObjectNode resolve(JsonNode record) {
        resolutions.incrementAndGet();
        JsonNode selected = selectedCodes(record);
        ObjectNode result = base(record);
        if (!Js.is(Js.field(selected, "state"), "known") || !bound(record, selected)) {
            result.put("state", "unknown");
            result.put("reason", Js.is(Js.field(selected, "state"), "known")
                    ? "configuration-identity-unavailable" : "selection-unavailable");
            result.put("selectedCount", selectedCount(selected));
            result.put("resolvedCount", 0);
            result.putArray("unresolved");
            result.putArray("definitions");
            return result;
        }
        JsonNode configuration = record.get("configuration");
        Set<String> contexts = new LinkedHashSet<>();
        JsonNode refs = Js.field(Js.field(record, "sourceContext"), "sourceRefs");
        if (refs != null && !refs.isNull()) {
            if (!refs.isArray()) throw new IllegalStateException("sourceRefs is not a list");
            for (JsonNode ref : refs) {
                if (!ref.isTextual()) throw new IllegalStateException("sourceRef is not text");
                if (ref.textValue().contains("/options/languages/")) contexts.add(ref.textValue());
            }
        }
        Variant variant = contexts.size() == 1 ? variants.get(contexts.iterator().next()) : null;
        boolean applicable = variant != null && Js.is(configuration.get("market"), variant.market())
                && Js.strictEquals(variant.vgModelCode(), configuration.get("vgModelCode"))
                && includes(variant.generations(), configuration.get("generation"))
                && includes(variant.agModelCodes(), configuration.get("agModelCode"));
        ArrayNode definitions = F.arrayNode();
        ArrayNode unresolved = F.arrayNode();
        for (JsonNode code : selected.get("options")) {
            JsonNode definition = applicable ? variant.definitions().get(code.textValue()) : null;
            if (!Js.is(Js.field(definition, "state"), "known")) {
                ObjectNode entry = unresolved.addObject();
                entry.set("code", code.deepCopy());
                JsonNode reason = definition == null ? null : definition.get("reason");
                entry.set("reason", !applicable ? F.textNode("definition-context-unavailable")
                        : reason != null && !reason.isNull() ? reason.deepCopy() : F.textNode("definition-unavailable"));
                continue;
            }
            JsonNode candidate = definition.get("candidates").get(0);
            String observedDate = variant.sources().get(candidate.get("sources").get(0).intValue())
                    .get("observedDate").textValue();
            ObjectNode entry = definitions.addObject();
            entry.set("code", code.deepCopy());
            entry.set("category", candidate.get("category").deepCopy());
            ObjectNode label = entry.putObject("label");
            label.put("state", "known");
            label.set("value", candidate.get("label").deepCopy());
            label.put("completeness", "partial");
            ObjectNode provenance = label.putObject("provenance");
            provenance.put("kind", "observed");
            provenance.set("source", variant.source().deepCopy());
            provenance.put("observedDate", observedDate);
        }
        result.put("state", unresolved.isEmpty() ? "complete" : definitions.isEmpty() ? "unknown" : "partial");
        if (unresolved.isEmpty()) result.putNull("reason");
        else result.put("reason", "selected-definitions-incomplete");
        result.put("selectedCount", selected.get("options").size());
        result.put("resolvedCount", definitions.size());
        result.set("unresolved", unresolved);
        result.set("definitions", definitions);
        return result;
    }

    private static boolean includes(JsonNode list, JsonNode value) {
        for (JsonNode item : list) if (Js.strictEquals(item, value)) return true;
        return false;
    }

    /** Node bound(): the selection is exactly the identity's factory option codes. */
    private static boolean bound(JsonNode record, JsonNode selected) {
        JsonNode options = Js.field(selected, "options");
        JsonNode configuration = Js.field(record, "configuration");
        if (!text(Js.field(record, "configurationId")) || !Js.isObject(configuration) || options == null
                || !options.isArray()) return false;
        List<String> codes = new ArrayList<>();
        for (JsonNode option : options) {
            if (!text(option)) return false;
            codes.add(option.textValue());
        }
        if (new LinkedHashSet<>(codes).size() != codes.size()) return false;
        JsonNode identity = Js.field(record, "canonicalIdentity");
        JsonNode factory = Js.field(identity, "factoryOptionCodes");
        if (factory == null || !factory.isArray() || !factory.equals(options)
                || !Js.strictEquals(identity.get("vgModelCode"), configuration.get("vgModelCode"))) return false;
        List<String> sorted = new ArrayList<>(codes);
        sorted.sort(null);
        String expected = Base64.getEncoder().encodeToString(
                (templateText(configuration.get("vgModelCode")) + ":" + String.join(",", sorted)).getBytes(StandardCharsets.UTF_8));
        return Js.is(record.get("configurationId"), expected);
    }

    /** JavaScript template-literal text of a JSON scalar; absent is the word undefined. */
    private static String templateText(JsonNode node) {
        if (node == null) return "undefined";
        if (node.isNull()) return "null";
        return node.isContainerNode() ? (node.isArray() ? "" : "[object Object]") : node.asText();
    }
}
