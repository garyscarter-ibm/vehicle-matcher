package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The validated identity inventory (identity-inventory.json), indexed for the unchanged-check and classification. */
final class RetainedHistory {

    record ConfigurationRow(String recordDigest, String originatingDatasetId) {}

    record IdentityRow(int index, String vehicleId, String vin17, String vin7, String configurationId,
            String originatingDatasetId, String associationDigest) {}

    private static final Set<String> KEYS =
            Set.of("schemaVersion", "revision", "contentDigest", "configurations", "identities", "datasets");

    final Map<String, ConfigurationRow> configurations = new HashMap<>();
    final List<IdentityRow> identities = new ArrayList<>();
    final Map<String, String> datasets = new HashMap<>();
    private final Map<String, IdentityRow> byVehicle = new HashMap<>();
    private final Map<String, IdentityRow> byVin = new HashMap<>();

    static RetainedHistory empty() {
        return new RetainedHistory();
    }

    IdentityRow identityByVin(String vin) {
        return byVin.get(vin);
    }

    /** First identity (inventory order) sharing a vehicle id, vin17 or vin7 with the candidate. */
    IdentityRow overlapping(String vehicleId, String vin17, String vin7) {
        IdentityRow best = null;
        for (IdentityRow row : new IdentityRow[] {byVehicle.get(vehicleId), byVin.get(vin17), byVin.get(vin7)}) {
            if (row != null && (best == null || row.index() < best.index())) best = row;
        }
        return best;
    }

    static String datasetKey(String datasetId, String version) {
        return datasetId + "\u0000" + version;
    }

    /** Port of Node validHistory; returns null when the inventory is not a valid sealed inventory. */
    static RetainedHistory validate(JsonNode value) {
        try {
            return build(value);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static RetainedHistory build(JsonNode value) {
        if (value == null || !value.isObject() || !"1".equals(text(value.get("schemaVersion"), true))
                || !safeNonNegativeInteger(value.get("revision"))
                || !value.path("configurations").isArray() || !value.path("identities").isArray()
                || !value.path("datasets").isArray()) {
            return null;
        }
        for (var it = value.fieldNames(); it.hasNext(); ) {
            if (!KEYS.contains(it.next())) return null;
        }
        var content = ((com.fasterxml.jackson.databind.node.ObjectNode) value).deepCopy();
        content.remove("contentDigest");
        JsonNode declared = value.get("contentDigest");
        if (declared == null || !declared.isTextual() || !declared.textValue().equals(CanonicalJson.digest(content))) {
            return null;
        }
        RetainedHistory history = new RetainedHistory();
        for (JsonNode row : value.get("configurations")) {
            String id = text(row.get("configurationId"), false);
            String origin = text(row.get("originatingDatasetId"), false);
            String digest = hash(row.get("recordDigest"));
            if (id == null || origin == null || digest == null) return null;
            if (history.configurations.put(id, new ConfigurationRow(digest, origin)) != null) return null;
        }
        int index = 0;
        for (JsonNode row : value.get("identities")) {
            String vehicleId = text(row.get("vehicleId"), false);
            String vin17 = row.path("vin17").asText(null);
            String vin7 = row.path("vin7").asText(null);
            String usage = row.path("usage").asText(null);
            String configurationId = text(row.get("configurationId"), true);
            String origin = text(row.get("originatingDatasetId"), false);
            if (!"synthetic".equals(row.path("identityKind").asText(null)) || vehicleId == null
                    || !("current-car".equals(usage) || "delivered-car".equals(usage))
                    || !row.path("vin17").isTextual() || !VinCheckDigit.isVin17(vin17)
                    || vin17.charAt(8) != VinCheckDigit.calculate(vin17)
                    || !row.path("vin7").isTextual() || !vin17.endsWith(vin7)
                    || hash(row.get("configurationHash")) == null || origin == null
                    || !origin.equals(row.path("vinAllocationOrigin").path("originatingDatasetId").asText(null))
                    || !history.configurations.containsKey(configurationId)) {
                return null;
            }
            IdentityRow identity = new IdentityRow(index++, vehicleId, vin17, vin7, configurationId, origin,
                    associationDigest(row));
            if (history.byVehicle.put(vehicleId, identity) != null || history.byVin.put(vin17, identity) != null
                    || history.byVin.put(vin7, identity) != null) {
                return null;
            }
            history.identities.add(identity);
        }
        for (JsonNode row : value.get("datasets")) {
            String datasetId = text(row.get("datasetId"), false);
            String version = text(row.get("version"), false);
            String digest = hash(row.get("manifestDigest"));
            if (datasetId == null || version == null || digest == null
                    || !digest.equals(row.path("directory").asText(null))) {
                return null;
            }
            if (history.datasets.put(datasetKey(datasetId, version), digest) != null) return null;
        }
        return history;
    }

    /** inputDigest of the association row without its usage member. */
    static String associationDigest(JsonNode row) {
        var copy = ((com.fasterxml.jackson.databind.node.ObjectNode) row).deepCopy();
        copy.remove("usage");
        return CanonicalJson.digest(copy);
    }

    static boolean safeNonNegativeInteger(JsonNode node) {
        if (node == null || !node.isNumber()) return false;
        double d = node.doubleValue();
        return d >= 0 && d == Math.floor(d) && d <= 9007199254740991.0;
    }

    /** A string of 1..4096 UTF-16 units (Node text()); with raw=true only requires a string. */
    static String text(JsonNode node, boolean raw) {
        if (node == null || !node.isTextual()) return null;
        String s = node.textValue();
        return raw || (!s.isEmpty() && s.length() <= 4096) ? s : null;
    }

    static String hash(JsonNode node) {
        String s = text(node, true);
        return s != null && s.length() == 64 && s.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))
                ? s : null;
    }
}
