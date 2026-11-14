package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.StockPort.RunLookup;
import gcsp.api.evidence.StockPort.StockRead;
import gcsp.api.evidence.StockPort.StockRecord;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Rebuilds the registry and stock doubles recorded in the s2 golden cases, and runs a case through the Java lookup. */
final class LookupCases {

    private static final Map<String, CorpusStore> STORES = new HashMap<>();

    private LookupCases() {}

    static synchronized CorpusStore store(String name) {
        return STORES.computeIfAbsent(name, key -> {
            Path root = EvidenceFixtures.required(EvidenceFixtures.REAL.resolve(key)).toAbsolutePath();
            CorpusStore store = new CorpusStore(root);
            if (!store.load().ready()) throw new AssertionError("Store did not load: " + key);
            return store;
        });
    }

    /** Counters for the stock double, compared with what Node recorded. */
    static final class StockCounts {
        int currentRun;
        int read;
    }

    static ObjectNode run(JsonNode entry, StockCounts counts) {
        EvidenceRegistry registry = registry(entry);
        StockPort stock = entry.get("stock") == null || entry.get("stock").isNull() ? null : stock(entry.get("stock"), counts);
        return new VehicleEvidenceLookup(registry, stock).resolve(EvidenceRequest.fromJson(entry.get("request")),
                EvidenceContext.fromJson(entry.get("context")));
    }

    static EvidenceRegistry registry(JsonNode entry) {
        if (entry.get("store").isNull()) return null;
        EvidenceRegistry real = EvidenceRegistry.of(store(entry.get("store").textValue()));
        JsonNode spec = entry.get("registry");
        if (spec == null) return real;
        return new EvidenceRegistry() {
            @Override
            public EvidenceSource getConfiguration(String id) {
                return patched(real.getConfiguration(id), spec);
            }

            @Override
            public EvidenceSource getVin(String id) {
                return patched(real.getVin(id), spec);
            }
        };
    }

    private static EvidenceSource patched(EvidenceSource source, JsonNode spec) {
        if (spec.path("throws").asBoolean(false)) throw new IllegalStateException("registry failure");
        if (spec.has("fixed")) return fromFlat(spec.get("fixed"));
        ObjectNode flat = toFlat(source);
        for (JsonNode pair : spec.path("set")) patch(flat, pair.get(0).textValue(), pair.get(1).deepCopy(), true);
        for (JsonNode path : spec.path("delete")) patch(flat, path.textValue(), null, false);
        return fromFlat(flat);
    }

    private static void patch(ObjectNode root, String path, JsonNode value, boolean set) {
        String[] parts = path.split("\\.");
        JsonNode node = root;
        for (int i = 0; i < parts.length - 1 && node != null; i++) node = child(node, parts[i]);
        if (node == null || !node.isContainerNode()) return;
        String last = parts[parts.length - 1];
        if (node instanceof ObjectNode object) {
            if (set) object.set(last, value);
            else object.remove(last);
        } else if (node instanceof ArrayNode array && set) {
            array.set(Integer.parseInt(last), value);
        }
    }

    private static JsonNode child(JsonNode node, String key) {
        if (node.isArray()) return node.get(Integer.parseInt(key));
        return node.isObject() ? node.get(key) : null;
    }

    private static ObjectNode toFlat(EvidenceSource source) {
        ObjectNode flat = EvidenceFixtures.MAPPER.createObjectNode();
        if (source.status() != null) flat.put("status", source.status());
        if (source.active() != null) {
            ActiveInfo active = source.active();
            ObjectNode node = flat.putObject("active");
            node.put("datasetId", active.datasetId());
            node.put("version", active.version());
            node.put("manifestDigest", active.manifestDigest());
        }
        if (source.record() != null) flat.set("record", source.record().deepCopy());
        if (source.vehicle() != null) flat.set("vehicle", source.vehicle().deepCopy());
        if (source.technicalSupplement() != null) flat.set("technicalSupplement", source.technicalSupplement().deepCopy());
        if (source.images() != null) {
            ArrayNode images = flat.putArray("images");
            for (JsonNode image : source.images()) images.add(image.deepCopy());
        }
        if (source.definitionResolution() != null) flat.set("definitionResolution", source.definitionResolution().deepCopy());
        return flat;
    }

    private static EvidenceSource fromFlat(JsonNode flat) {
        JsonNode active = flat.get("active");
        ActiveInfo info = active == null || !active.isObject() ? null
                : new ActiveInfo(text(active.get("datasetId")), text(active.get("version")), text(active.get("manifestDigest")),
                        null, null, null);
        List<JsonNode> images = null;
        if (flat.has("images") && flat.get("images").isArray()) {
            images = new ArrayList<>();
            flat.get("images").forEach(images::add);
        }
        return new EvidenceSource(text(flat.get("status")), info, flat.get("record"), flat.get("vehicle"),
                flat.get("technicalSupplement"), images, flat.get("definitionResolution"));
    }

    private static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    private static StockPort stock(JsonNode spec, StockCounts counts) {
        JsonNode steps = spec.get("currentRuns");
        JsonNode read = spec.get("read");
        return new StockPort() {
            @Override
            public RunLookup currentRun(String environmentId) {
                JsonNode step = steps.get(Math.min(counts.currentRun++, steps.size() - 1));
                if (step.path("throws").asBoolean(false)) throw new IllegalStateException("run lookup failure");
                return new RunLookup(step.get("status").textValue(), text(step.get("runId")));
            }

            @Override
            public StockRead read(EvidenceContext context, String orderUuid) {
                counts.read++;
                if (read.path("throws").asBoolean(false)) throw new IllegalStateException("stock read failure");
                JsonNode record = read.get("record");
                StockRecord row = record == null || !record.isObject() ? null
                        : new StockRecord(text(record.get("runId")), text(record.get("orderUuid")), text(record.get("orderNumber")),
                                text(record.get("configurationId")), record.get("facts"));
                return new StockRead(read.get("status").textValue(), row);
            }
        };
    }

    /** First differing path between two trees, or null when canonically equal. */
    static String diff(String path, JsonNode expected, JsonNode actual) {
        if (CanonicalJson.canonical(expected).equals(CanonicalJson.canonical(actual))) return null;
        if (expected != null && actual != null && expected.isObject() && actual.isObject()) {
            List<String> names = new ArrayList<>();
            expected.fieldNames().forEachRemaining(names::add);
            actual.fieldNames().forEachRemaining(name -> {
                if (!names.contains(name)) names.add(name);
            });
            for (String name : names) {
                String found = diff(path + "." + name, expected.get(name), actual.get(name));
                if (found != null) return found;
            }
        }
        if (expected != null && actual != null && expected.isArray() && actual.isArray() && expected.size() == actual.size()) {
            for (int i = 0; i < expected.size(); i++) {
                String found = diff(path + "[" + i + "]", expected.get(i), actual.get(i));
                if (found != null) return found;
            }
        }
        return path + ": expected " + abbreviate(expected) + " but was " + abbreviate(actual);
    }

    private static String abbreviate(JsonNode node) {
        String text = node == null ? "<absent>" : CanonicalJson.canonical(node);
        return text.length() > 160 ? text.substring(0, 160) + "..." : text;
    }
}
