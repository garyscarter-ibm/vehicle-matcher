package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.CorpusResults.Classification;
import gcsp.api.evidence.CorpusResults.ConfigurationResult;
import gcsp.api.evidence.CorpusResults.Status;
import gcsp.api.evidence.CorpusResults.VinResult;
import gcsp.api.evidence.IndexedJsonl.Meta;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** Retained corpus reader. Delta from Node: verifies identity and integrity at load, not row admission. */
public final class CorpusStore {

    private static final String[] FILES = {"configurations.jsonl", "vins.jsonl", "images.jsonl"};
    private static final Pattern LOOKUP_VIN = Pattern.compile("(?:[A-HJ-NPR-Z0-9]{17}|[A-HJ-NPR-Z0-9]{7})");
    private static final long MANIFEST_MAX = 64L * 1024 * 1024;

    private final Path root;
    private final long maxFileBytes;
    private volatile Snapshot snapshot;
    private volatile HistoryState history;

    public CorpusStore(Path root) {
        this(root, IndexedJsonl.DEFAULT_MAX_BYTES);
    }

    public CorpusStore(Path root, long maxFileBytes) {
        if (root == null || !root.isAbsolute()) throw new IllegalArgumentException("Supply an absolute corpus store root.");
        if (maxFileBytes <= 0 || maxFileBytes > IndexedJsonl.HARD_CAP_BYTES) {
            throw new IllegalArgumentException("maxFileBytes must be between 1 and 256 MiB.");
        }
        this.root = root.normalize();
        this.maxFileBytes = maxFileBytes;
    }

    // ---- state ---------------------------------------------------------------------------------------------

    private record HistoryState(RetainedHistory history, CorpusFailure failure) {}

    private record Snapshot(JsonNode manifest, String manifestDigest, IndexedJsonl configurations, IndexedJsonl vins,
            IndexedJsonl images, Map<String, String> vinKeys, Map<String, List<String>> configurationImages) {}

    private record Verified(JsonNode manifest, String manifestDigest, IndexedJsonl[] files) {}

    private record Selection(String directory, String manifestDigest) {}

    /** Thrown inside load to carry a refusal out of the selection helpers. */
    private static final class Refusal extends Exception {
        private final transient CorpusFailure failure;

        Refusal(CorpusFailure failure) {
            super(failure.code(), null, false, false);
            this.failure = failure;
        }
    }

    // ---- load ----------------------------------------------------------------------------------------------

    /** Validates the store and swaps in the selected corpus (or the recovered previous one). Safe to call again. */
    public synchronized LoadOutcome load() {
        try {
            HistoryState state = readHistory();
            history = state;
            if (state.failure() != null) return outcome(state.failure(), false);
            JsonNode pointer = readJsonOrNull("active.json");
            boolean v1 = pointer != null && pointer.isObject() && pointer.has("schemaVersion")
                    && "1".equals(pointer.get("schemaVersion").asText(null)) && pointer.get("schemaVersion").isTextual();
            if (v1 && pointer.has("selected") && pointer.get("selected").isNull()) {
                snapshot = null;
                return outcome(new CorpusFailure("corpus-deactivated",
                        "No corpus is selected. Synthetic identity routing history is retained."), false);
            }
            CorpusFailure failed = new CorpusFailure("corpus-absent",
                    "No validated corpus is selected; this is source-unavailable, not a valid empty registry.");
            if (v1) {
                try {
                    snapshot = open(selection(pointer.get("selected")), state.history(), "selected");
                    return new LoadOutcome("ok", null, false, info());
                } catch (Refusal refusal) {
                    failed = refusal.failure;
                }
            }
            Selection previous = pointer == null ? null : selection(pointer.get("previous"));
            if (previous == null) {
                JsonNode good = readJsonOrNull("last-good.json");
                previous = good != null && good.isObject() && good.path("schemaVersion").isTextual()
                        && "1".equals(good.get("schemaVersion").textValue()) ? selection(good.get("selected")) : null;
            }
            if (previous != null) {
                try {
                    snapshot = open(previous, state.history(), "previous");
                    return new LoadOutcome("source-unavailable", failed, true, info());
                } catch (Refusal ignored) {
                    return outcome(failed, false);
                }
            }
            return outcome(failed, false);
        } catch (RuntimeException e) {
            return outcome(new CorpusFailure("store-unavailable",
                    "The corpus store is unavailable. The last complete in-memory version remains readable."), false);
        }
    }

    private LoadOutcome outcome(CorpusFailure failure, boolean recovered) {
        return new LoadOutcome("source-unavailable", failure, recovered, info());
    }

    private static Selection selection(JsonNode node) {
        if (node == null || !node.isObject() || node.size() != 2) return null;
        String digest = RetainedHistory.hash(node.get("manifestDigest"));
        JsonNode directory = node.get("directory");
        return digest != null && directory != null && directory.isTextual() && digest.equals(directory.textValue())
                ? new Selection(digest, digest) : null;
    }

    private Snapshot open(Selection selection, RetainedHistory retained, String which) throws Refusal {
        if (selection == null) {
            throw new Refusal(new CorpusFailure("selection-invalid", "The selected version reference is invalid."));
        }
        Verified verified;
        try {
            verified = verify(root.resolve("versions").resolve(selection.directory()));
        } catch (CorpusException e) {
            throw invalid(e.code());
        }
        if (!verified.manifestDigest().equals(selection.manifestDigest())) throw invalid("manifest-digest-mismatch");
        String conflict = unchangedHistory(retained, verified);
        if (conflict != null) {
            throw new Refusal(new CorpusFailure("selection-history-mismatch",
                    "The selected corpus is absent from or conflicts with durable identity history.",
                    "".equals(conflict) ? null : conflict, "".equals(conflict)));
        }
        return snapshotOf(verified);
    }

    private static Refusal invalid(String cause) {
        return new Refusal(new CorpusFailure("selected-corpus-invalid",
                "The selected complete corpus failed validation.", cause, false));
    }

    // ---- publication identity and integrity ------------------------------------------------------------------

    private Verified verify(Path directory) {
        byte[] manifestBytes;
        try {
            manifestBytes = readBounded(directory.resolve("manifest.json"));
        } catch (IOException e) {
            throw new CorpusException("artifact-unavailable", "manifest.json is not readable.");
        }
        JsonNode manifest;
        try {
            manifest = StrictJson.parse(manifestBytes, manifestBytes.length);
        } catch (IOException e) {
            throw new CorpusException("manifest-schema", "manifest.json is malformed.");
        }
        requireManifestShape(manifest);
        IndexedJsonl[] files = new IndexedJsonl[3];
        for (int i = 0; i < 3; i++) {
            files[i] = IndexedJsonl.index(directory.resolve(FILES[i]), maxFileBytes, handler(i), duplicateCode(i));
            if (!files[i].checksum().equals(manifest.get("checksums").get(FILES[i]).textValue())) {
                throw new CorpusException("checksum-mismatch", FILES[i] + " checksum failed; the active corpus is unchanged.");
            }
        }
        for (IndexedJsonl file : files) file.requireValidRows();
        Set<String> vinValues = new java.util.HashSet<>();
        for (IndexedJsonl.Entry vin : files[1].entries()) {
            if (!vinValues.add(vin.meta().vin17()) || !vinValues.add(vin.meta().vin7())) {
                throw new CorpusException("duplicate-vin", "VIN17, VIN7 and physical vehicle IDs must be unique.");
            }
        }
        if (files[0].size() == 0 || files[0].size() > IndexedJsonl.MAX_ROWS) {
            throw new CorpusException("configuration-schema", "A valid corpus needs at least one configuration.");
        }
        JsonNode counts = manifest.get("counts");
        String[] countKeys = {"configurations", "vinMappings", "images"};
        for (int i = 0; i < 3; i++) {
            JsonNode count = counts.get(countKeys[i]);
            if (count == null || !count.isNumber() || count.doubleValue() != files[i].size()) {
                throw new CorpusException("count-mismatch", "Declared record counts do not reconcile.");
            }
        }
        checkReferences(files);
        return new Verified(manifest, CanonicalJson.sha256Hex(manifestBytes), files);
    }

    private static void requireManifestShape(JsonNode manifest) {
        JsonNode checksums = manifest.path("checksums");
        boolean ok = manifest.isObject() && RetainedHistory.text(manifest.get("datasetId"), false) != null
                && RetainedHistory.text(manifest.get("version"), false) != null
                && manifest.path("schemaVersion").isTextual()
                && Set.of("1", "2").contains(manifest.get("schemaVersion").textValue())
                && checksums.isObject() && checksums.size() == 3 && manifest.path("counts").isObject();
        for (int i = 0; ok && i < 3; i++) ok = RetainedHistory.hash(checksums.get(FILES[i])) != null;
        if (!ok) {
            throw new CorpusException("manifest-schema", "Supply the compatible complete manifest with explicit versions,"
                    + " counts and every artifact checksum.");
        }
    }

    private static String duplicateCode(int file) {
        return new String[] {"duplicate-configuration", "duplicate-vin", "duplicate-image"}[file];
    }

    private static IndexedJsonl.RowHandler handler(int file) {
        return switch (file) {
            case 0 -> CorpusStore::configurationMeta;
            case 1 -> CorpusStore::vinMeta;
            default -> CorpusStore::imageMeta;
        };
    }

    private static Meta configurationMeta(JsonNode row) {
        String id = RetainedHistory.text(row.get("configurationId"), false);
        List<String> imageIds = new ArrayList<>();
        boolean ok = id != null && RetainedHistory.text(row.get("snapshotVersion"), false) != null
                && row.path("configuration").isObject() && row.path("sourceContext").isObject()
                && row.path("canonicalIdentity").isObject() && row.path("imageIds").isArray();
        if (ok) {
            for (JsonNode imageId : row.get("imageIds")) {
                String value = RetainedHistory.text(imageId, false);
                if (value == null) ok = false; else imageIds.add(value);
            }
        }
        if (!ok) throw new CorpusException("configuration-schema", "Configuration rows need their description fields.");
        return new Meta(id, id, null, null, null, List.copyOf(imageIds));
    }

    private static Meta vinMeta(JsonNode row) {
        String vehicleId = RetainedHistory.text(row.get("vehicleId"), false);
        String configurationId = RetainedHistory.text(row.get("configurationId"), false);
        String vin17 = row.path("vin17").isTextual() ? row.get("vin17").textValue() : null;
        String vin7 = row.path("vin7").isTextual() ? row.get("vin7").textValue() : null;
        if (vehicleId == null || configurationId == null || !VinCheckDigit.isVin17(vin17) || vin7 == null
                || !vin17.endsWith(vin7) || vin7.length() != 7) {
            throw new CorpusException("vin-schema", "Only complete synthetic VIN associations may be published.");
        }
        return new Meta(vehicleId, configurationId, vin17, vin7, RetainedHistory.associationDigest(row), List.of());
    }

    private static Meta imageMeta(JsonNode row) {
        String imageId = RetainedHistory.text(row.get("imageId"), false);
        String configurationId = RetainedHistory.text(row.get("configurationId"), false);
        if (imageId == null || configurationId == null) {
            throw new CorpusException("artifact-schema", "Image rows need an image and a configuration id.");
        }
        return new Meta(imageId, configurationId, null, null, null, List.of());
    }

    private static void checkReferences(IndexedJsonl[] files) {
        Map<String, String> imageOwner = new HashMap<>();
        for (IndexedJsonl.Entry image : files[2].entries()) {
            if (files[0].entry(image.meta().configurationId()) == null) {
                throw new CorpusException("dangling-configuration", "An image references a missing configuration.");
            }
            imageOwner.put(image.key(), image.meta().configurationId());
        }
        for (IndexedJsonl.Entry vin : files[1].entries()) {
            if (files[0].entry(vin.meta().configurationId()) == null) {
                throw new CorpusException("dangling-configuration", "A VIN references a missing configuration.");
            }
        }
        for (IndexedJsonl.Entry configuration : files[0].entries()) {
            for (String imageId : configuration.meta().imageIds()) {
                if (!configuration.key().equals(imageOwner.get(imageId))) {
                    throw new CorpusException("dangling-image", "Every image reference must resolve to the same configuration.");
                }
            }
        }
    }

    /** Node mergeHistory as an unchanged-check: null when unchanged, "" when absent, else the conflict code. */
    private static String unchangedHistory(RetainedHistory retained, Verified verified) {
        JsonNode manifest = verified.manifest();
        String known = retained.datasets.get(RetainedHistory.datasetKey(manifest.get("datasetId").textValue(),
                manifest.get("version").textValue()));
        boolean changed = false;
        if (known == null) {
            changed = true;
        } else if (!known.equals(verified.manifestDigest())) {
            return "dataset-version-conflict";
        }
        for (IndexedJsonl.Entry entry : verified.files()[0].entries()) {
            RetainedHistory.ConfigurationRow previous = retained.configurations.get(entry.key());
            if (previous == null) changed = true;
            else if (!previous.recordDigest().equals(entry.recordDigest())) return "historical-configuration-conflict";
        }
        for (IndexedJsonl.Entry entry : verified.files()[1].entries()) {
            RetainedHistory.IdentityRow previous =
                    retained.overlapping(entry.key(), entry.meta().vin17(), entry.meta().vin7());
            if (previous == null) changed = true;
            else if (!previous.associationDigest().equals(entry.meta().associationDigest())) {
                return "historical-identity-conflict";
            }
        }
        return changed ? "" : null;
    }

    private static Snapshot snapshotOf(Verified verified) {
        IndexedJsonl[] files = verified.files();
        Map<String, String> vinKeys = new HashMap<>();
        for (IndexedJsonl.Entry vin : files[1].entries()) {
            vinKeys.put(vin.meta().vin17(), vin.key());
            vinKeys.put(vin.meta().vin7(), vin.key());
        }
        Map<String, List<String>> byConfiguration = new HashMap<>();
        for (IndexedJsonl.Entry image : files[2].entries()) {
            byConfiguration.computeIfAbsent(image.meta().configurationId(), k -> new ArrayList<>()).add(image.key());
        }
        return new Snapshot(verified.manifest(), verified.manifestDigest(), files[0], files[1], files[2], vinKeys,
                byConfiguration);
    }

    // ---- history -------------------------------------------------------------------------------------------

    private HistoryState readHistory() {
        try {
            byte[] bytes = readBounded(root.resolve("identity-inventory.json"));
            RetainedHistory valid = RetainedHistory.validate(StrictJson.parse(bytes, bytes.length));
            return valid != null ? new HistoryState(valid, null)
                    : failedHistory("identity-inventory-invalid",
                            "The independent synthetic identity inventory is invalid. All live forwarding remains disabled.");
        } catch (NoSuchFileException missing) {
            if (emptyStore()) return new HistoryState(RetainedHistory.empty(), null);
        } catch (IOException | RuntimeException e) {
            // Fall through: an unreadable inventory is never interpreted as a fresh one.
        }
        return failedHistory("identity-inventory-unavailable",
                "Restore the retained synthetic identity inventory before loading; no synthetic identity may be forwarded live.");
    }

    private static HistoryState failedHistory(String code, String message) {
        return new HistoryState(null, new CorpusFailure(code, message));
    }

    private boolean emptyStore() {
        try {
            Set<String> names = names(root);
            return !names.contains("active.json") && !names.contains("last-good.json")
                    && names(root.resolve("versions")).isEmpty();
        } catch (IOException e) {
            return false;
        }
    }

    private static Set<String> names(Path directory) throws IOException {
        try (Stream<Path> list = Files.list(directory)) {
            Set<String> out = new LinkedHashSet<>();
            list.forEach(p -> out.add(p.getFileName().toString()));
            return out;
        } catch (NoSuchFileException e) {
            return Set.of();
        }
    }

    private JsonNode readJsonOrNull(String name) {
        try {
            byte[] bytes = readBounded(root.resolve(name));
            return StrictJson.parse(bytes, bytes.length);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static byte[] readBounded(Path path) throws IOException {
        BasicFileAttributes attributes = Files.readAttributes(path, BasicFileAttributes.class);
        if (!attributes.isRegularFile() || attributes.size() > MANIFEST_MAX) {
            throw new CorpusException("artifact-size", "Artifact is not a regular file or exceeds the 64 MiB limit.");
        }
        return Files.readAllBytes(path);
    }

    // ---- reads -----------------------------------------------------------------------------------------------

    private ActiveInfo info() {
        Snapshot current = snapshot;
        if (current == null) return null;
        JsonNode m = current.manifest();
        return new ActiveInfo(m.get("datasetId").textValue(), m.get("version").textValue(), current.manifestDigest(),
                copy(m.get("counts")), copy(m.get("sourceContexts")), copy(m.get("completeness")));
    }

    private static JsonNode copy(JsonNode node) {
        return node == null ? null : node.deepCopy();
    }

    private static CorpusFailure absent() {
        return new CorpusFailure("corpus-absent", "No validated corpus is selected.");
    }

    private static CorpusFailure changed() {
        return new CorpusFailure("indexed-corpus-changed",
                "The selected indexed corpus changed; reload a complete validated version.");
    }

    /** "ok" when a validated corpus is selected, otherwise "source-unavailable". */
    public Status status() {
        Snapshot current = snapshot;
        return new Status(current != null ? "ok" : "source-unavailable", info());
    }

    public ConfigurationResult getConfiguration(String id) {
        Snapshot current = snapshot;
        if (current == null) return new ConfigurationResult("source-unavailable", absent(), null, null, null, null, null, null);
        ActiveInfo active = info();
        if (id == null || id.isEmpty() || id.length() > 4096) {
            return new ConfigurationResult("invalid-input", null, active, null, null, null, null, null);
        }
        try {
            JsonNode row = current.configurations().get(id);
            if (row == null) return new ConfigurationResult("not-found", null, active, null, null, null, null, null);
            Set<String> imageIds = new LinkedHashSet<>();
            for (JsonNode imageId : row.get("imageIds")) imageIds.add(imageId.textValue());
            imageIds.addAll(current.configurationImages().getOrDefault(id, List.of()));
            List<JsonNode> images = new ArrayList<>();
            for (String imageId : imageIds) {
                JsonNode image = current.images().get(imageId);
                if (image == null) throw new CorpusException("artifact-changed", "Indexed image is absent.");
                images.add(image);
            }
            JsonNode catalogueStatus = row.path("catalogue").path("status");
            String status = catalogueStatus.isTextual() && !catalogueStatus.textValue().isEmpty()
                    ? catalogueStatus.textValue() : "partial";
            JsonNode kind = row.path("sourceContext").get("sourceKind");
            return new ConfigurationResult(status, null, active, kind != null && kind.isTextual() ? kind.textValue() : null,
                    row, supplement(current, id), images, images.isEmpty() ? "unavailable" : "representative");
        } catch (CorpusException e) {
            return new ConfigurationResult("source-unavailable", changed(), active, null, null, null, null, null);
        }
    }

    private static JsonNode supplement(Snapshot current, String configurationId) {
        for (JsonNode supplement : current.manifest().path("technicalSupplements")) {
            if (configurationId.equals(supplement.path("configurationId").asText(null))) return supplement.deepCopy();
        }
        return null;
    }

    public VinResult getVin(String vin) {
        Snapshot current = snapshot;
        if (current == null) {
            return new VinResult("source-unavailable", absent(), kindOf(vin), false, null, null, null, null);
        }
        ActiveInfo active = info();
        if (vin == null || !LOOKUP_VIN.matcher(vin).matches()) {
            return new VinResult("invalid-input", null, null, false, active, null, null, null);
        }
        try {
            String key = current.vinKeys().get(vin);
            JsonNode row = key == null ? null : current.vins().get(key);
            if (row == null) return new VinResult("not-found", null, kindOf(vin), false, active, null, null, null);
            ConfigurationResult configuration = getConfiguration(row.get("configurationId").textValue());
            if (configuration.record() == null) {
                return new VinResult(configuration.status(), configuration.failure(), "synthetic", false,
                        configuration.active(), null, configuration, null);
            }
            return new VinResult(configuration.status(), null, "synthetic", false, active, row, configuration,
                    "A fictional VIN association to retained source facts; this is not a factory build or authentication.");
        } catch (CorpusException e) {
            return new VinResult("source-unavailable", changed(), "synthetic", false, active, null, null, null);
        }
    }

    private String kindOf(String vin) {
        HistoryState state = history;
        return state != null && state.history() != null && vin != null && state.history().identityByVin(vin) != null
                ? "synthetic" : "unknown";
    }

    public Classification classifyIdentity(String vin) {
        HistoryState state = history;
        if (state == null) return unclassified(absent());
        if (state.failure() != null) return unclassified(state.failure());
        RetainedHistory.IdentityRow row = vin == null ? null : state.history().identityByVin(vin);
        return row == null ? new Classification("not-found", null, "unknown", false, null, null, null)
                : new Classification("ok", null, "synthetic", false, row.vehicleId(), row.configurationId(),
                        row.originatingDatasetId());
    }

    public Classification classifyConfiguration(String configurationId) {
        HistoryState state = history;
        if (state == null) return unclassified(absent());
        if (state.failure() != null) return unclassified(state.failure());
        RetainedHistory.ConfigurationRow row = configurationId == null ? null : state.history().configurations.get(configurationId);
        return row == null ? new Classification("not-found", null, "unknown", false, null, null, null)
                : new Classification("ok", null, "synthetic", false, null, configurationId, row.originatingDatasetId());
    }

    private static Classification unclassified(CorpusFailure failure) {
        return new Classification("source-unavailable", failure, "unknown", false, null, null, null);
    }
}
