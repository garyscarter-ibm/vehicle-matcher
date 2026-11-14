package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.StockPort.StockRecord;
import java.util.List;
import java.util.Map;

/** Evidence projection ported from Node vehicle-details-contract.js; a Java null is JS undefined and is omitted. */
final class VehicleDetails {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final List<String> MEASUREMENT_KEYS = List.of("seats", "luggageNormal", "luggageExpanded",
            "acceleration", "bodyLength");
    private static final Map<String, String[]> MEASUREMENTS = Map.of(
            "seats", new String[] {"SEATS", "COUNT"},
            "luggageNormal", new String[] {"NORMAL", "LITRES"},
            "luggageExpanded", new String[] {"EXPANDED", "LITRES"},
            "acceleration", new String[] {"0–100 KM/H", "SECONDS"},
            "bodyLength", new String[] {"BODY LENGTH", "MILLIMETRES"});

    private VehicleDetails() {}

    /** Reads the canonical generated snapshot and the legacy allocation envelope; null when absent or unknown. */
    static JsonNode stockSyntheticIdentity(StockRecord stock) {
        JsonNode snapshot = stock == null ? null : stock.facts();
        if (!Js.is(Js.field(snapshot, "contractVersion"), "vehicle-snapshot-v1")) {
            return Js.field(snapshot, "syntheticIdentity");
        }
        JsonNode fact = Js.field(Js.field(snapshot, "facts"), "syntheticIdentity");
        boolean exact = Js.is(Js.field(snapshot, "identityKind"), "exact-stock")
                && Js.is(Js.field(Js.field(snapshot, "sourceKeys"), "stockId"), stock.orderUuid())
                && Js.is(Js.field(fact, "status"), "known") && Js.isObject(Js.field(fact, "value"));
        return exact ? fact.get("value") : null;
    }

    /** Only called after the lookup has checked the exact immutable associations. */
    static ObjectNode details(String kind, String id, EvidenceSource source, StockRecord stock) {
        JsonNode record = source.record();
        JsonNode configuration = record.get("configuration");
        JsonNode catalogue = Js.field(record, "catalogue");
        JsonNode vehicle = source.vehicle();
        JsonNode identity = Js.or(stockSyntheticIdentity(stock), vehicle);
        String status = "partial".equals(source.status()) ? "partial" : "complete";
        JsonNode evidence = record.get("sourceContext");
        boolean dated = Js.is(Js.field(evidence, "sourceKind"), "dated-snapshot");
        ObjectNode provenance = F.objectNode();
        provenance.put("kind", dated ? "observed" : "reference");
        set(provenance, "source", Js.copy(Js.field(evidence, "sourceRefs")));
        set(provenance, "observedDate", Js.field(evidence, "observedDate"));

        ObjectNode equipment = equipmentFacts(catalogue, source.definitionResolution());
        ArrayNode items = F.arrayNode();
        if (source.images() != null) {
            for (JsonNode image : source.images()) {
                ObjectNode item = F.objectNode();
                for (String key : List.of("imageId", "asset", "role", "fidelity", "sourceKind", "observedDate")) {
                    set(item, key, Js.field(image, key));
                }
                item.put("label", Js.is(Js.field(image, "fidelity"), "representative-configuration")
                        ? "Representative configuration image" : "Representative model image");
                items.add(item);
            }
        }
        boolean hasImages = !items.isEmpty();

        ObjectNode result = EvidenceFailures.base(status, kind);
        ObjectNode requested = result.putObject("requested");
        requested.put("kind", kind);
        requested.put("id", id);
        ObjectNode resolved = result.putObject("resolved");
        resolved.put("kind", kind);
        resolved.put("id", id);
        set(resolved, "configurationId", Js.field(record, "configurationId"));

        ObjectNode identityNode = result.putObject("identity");
        identityNode.put("kind", kind);
        identityNode.put("identityKind", "synthetic");
        set(identityNode, "configurationId", Js.field(record, "configurationId"));
        set(identityNode, "vehicleId", orNull(Js.field(identity, "vehicleId")));
        ActiveInfo active = source.active();
        identityNode.put("datasetId", active.datasetId());
        identityNode.set("originatingDatasetId", Js.or(Js.field(identity, "originatingDatasetId"),
                F.textNode(active.datasetId())).deepCopy());
        identityNode.put("orderUuid", stock != null && Js.text(stock.orderUuid()) ? stock.orderUuid() : null);
        identityNode.put("orderNumber", stock != null && Js.text(stock.orderNumber()) ? stock.orderNumber() : null);
        if ("vin".equals(kind)) set(identityNode, "vin", Js.field(vehicle, "vin17"));
        else identityNode.putNull("vin");
        if (stock != null) identityNode.put("usage", "stock");
        else set(identityNode, "usage", Js.or(Js.field(vehicle, "usage"), F.textNode("configuration")));

        ObjectNode versions = result.putObject("versions");
        versions.put("corpus", active.version());
        versions.put("manifestDigest", active.manifestDigest());
        set(versions, "snapshot", Js.field(record, "snapshotVersion"));
        set(versions, "profileRegistry", orNull(Js.field(Js.field(vehicle, "profile"), "registryVersion")));
        set(versions, "generator", orNull(Js.field(identity, "generatorVersion")));

        ObjectNode description = result.putObject("description");
        description.set("model", attributed(Js.field(configuration, "model"), provenance));
        description.set("derivative", attributed(Js.field(configuration, "derivative"), provenance));
        description.set("generation", attributed(Js.field(configuration, "generation"), provenance));
        description.set("bodyType", attributed(Js.field(configuration, "body"), provenance));
        ObjectNode powertrain = description.putObject("powertrain");
        powertrain.set("fuel", attributed(Js.field(configuration, "powertrain"), provenance));
        powertrain.set("drive", attributed(Js.field(configuration, "drive"), provenance));
        powertrain.set("transmission", attributed(Js.field(configuration, "transmission"), provenance));
        powertrain.set("engine", attributed(Js.field(configuration, "engineCode"), provenance));
        description.set("paint", selectedAppearance(equipment, "paint"));
        description.set("upholstery", selectedAppearance(equipment, "fabric"));

        result.set("technical", technicalFacts(catalogue, source.technicalSupplement()));
        result.set("equipment", equipment);
        ObjectNode images = result.putObject("images");
        images.put("state", hasImages ? "representative" : "unknown");
        images.put("label", hasImages ? "Representative imagery" : "Images unavailable");
        images.set("items", items);

        ObjectNode src = result.putObject("source");
        set(src, "kind", Js.field(evidence, "sourceKind"));
        src.set("references", Js.copy(Js.field(evidence, "sourceRefs")));
        set(src, "confidence", Js.field(evidence, "confidence"));
        set(src, "observedDate", Js.field(evidence, "observedDate"));
        src.set("retrievedDate", orNull(Js.field(catalogue, "retrievedDate")).deepCopy());
        set(src, "catalogueDate", Js.field(evidence, "catalogueDate"));
        src.set("catalogueValidity", Js.copy(Js.field(catalogue, "catalogueValidity")));
        src.set("requestedIdentity", Js.copy(Js.field(catalogue, "requestedIdentity")));
        src.set("resolvedIdentity", Js.copy(Js.field(catalogue, "resolvedIdentity")));
        src.set("configurationIdentity", Js.copy(Js.field(record, "canonicalIdentity")));
        for (String key : List.of("market", "region", "steering", "agModelCode", "vgModelCode", "modelYear",
                "productionEra", "productionDate")) {
            set(src, key, Js.field(configuration, key));
        }
        src.set("registrationDate", orNull(Js.field(vehicle, "registrationDate")).deepCopy());
        src.set("profile", Js.copy(Js.field(vehicle, "profile")));
        src.set("profileSources", Js.copy(Js.field(vehicle, "sources")));
        src.set("profileConfidence", orNull(Js.field(vehicle, "confidence")).deepCopy());
        src.put("completeVinDecoded", false);
        src.set("unresolvedFacts", Js.copy(Js.field(evidence, "unresolvedFacts")));
        src.set("identityProvenance", Js.copy(Js.field(Js.field(record, "canonicalIdentity"), "provenance")));

        JsonNode completeness = Js.field(catalogue, "completeness");
        boolean v2 = Js.is(Js.field(catalogue, "schemaVersion"), "2");
        JsonNode resolution = source.definitionResolution();
        ObjectNode done = result.putObject("completeness");
        done.put("record", status);
        set(done, "selectedOptions", Js.field(evidence, "selectedOptionCompleteness"));
        done.set("measurements", source.technicalSupplement() != null && Js.truthy(source.technicalSupplement())
                ? F.textNode("partial")
                : Js.or(Js.field(completeness, "measurements"), F.textNode("unknown")).deepCopy());
        JsonNode resolvedState = Js.truthy(Js.field(resolution, "resolvedCount")) ? Js.field(resolution, "state") : null;
        JsonNode definitions = v2 ? Js.field(completeness, "definitions") : Js.field(completeness, "optionDefinitions");
        done.set("optionDefinitions", Js.or(Js.or(resolvedState, definitions), F.textNode("unknown")).deepCopy());
        JsonNode availability = v2 ? Js.field(completeness, "availability") : Js.field(completeness, "availableOptions");
        done.set("availableOptions", Js.or(availability, F.textNode("unknown")).deepCopy());
        done.put("verifiedFitted", "unknown");
        done.put("images", hasImages ? "representative" : "unknown");

        ObjectNode presentation = result.putObject("presentation");
        presentation.put("syntheticLabel", "Vehicle identity");
        presentation.put("associationLabel",
                "Identity association to retained configuration evidence; not a factory build or authentication.");
        presentation.put("sourceLabel", dated ? "Dated catalogue snapshot" : "North American structural reference");
        presentation.put("verifiedFittedLabel", "VIN-fitted equipment unknown");
        presentation.put("unknownLabel", "Unknown");
        presentation.put("imageLabel", hasImages ? "Representative imagery" : "Images unavailable");
        return result;
    }

    /** Node validVehicleEvidenceSource: the structural checks before any projection. */
    static boolean validSource(EvidenceSource source) {
        if (source == null) return false;
        JsonNode record = source.record();
        if (!Js.isObject(record) || !Js.isObject(record.get("configuration")) || !Js.isObject(record.get("sourceContext"))
                || !Js.isObject(record.get("canonicalIdentity"))) return false;
        ActiveInfo active = source.active();
        if (active == null || active.datasetId() == null || active.version() == null) return false;
        JsonNode context = record.get("sourceContext");
        if (!isArray(context.get("sourceRefs")) || !isArray(context.get("unresolvedFacts"))) return false;
        if (source.images() == null) return false;
        for (JsonNode image : source.images()) {
            if (!Js.isObject(image) || !Js.strictEquals(image.get("configurationId"), record.get("configurationId"))) return false;
            JsonNode role = image.get("role");
            if (!(Js.is(role, "representative-model") || Js.is(role, "representative-configuration"))) return false;
            if (!Js.strictEquals(role, image.get("fidelity"))) return false;
        }
        return true;
    }

    private static boolean isArray(JsonNode node) {
        return node != null && node.isArray();
    }

    private static ObjectNode unknown(String reason) {
        ObjectNode node = F.objectNode();
        node.put("state", "unknown");
        node.putNull("value");
        node.put("reason", reason);
        node.put("completeness", "unknown");
        ObjectNode provenance = node.putObject("provenance");
        provenance.put("kind", "unknown");
        provenance.putNull("source");
        provenance.putNull("observedDate");
        return node;
    }

    private static ObjectNode attributed(JsonNode value, JsonNode provenance) {
        if (value == null || value.isNull()) return unknown("source-evidence-unavailable");
        ObjectNode node = F.objectNode();
        node.put("state", "known");
        node.set("value", value.deepCopy());
        node.put("completeness", "partial");
        node.set("provenance", provenance.deepCopy());
        return node;
    }

    private static ObjectNode technicalFacts(JsonNode catalogue, JsonNode supplement) {
        ObjectNode facts = F.objectNode();
        for (String key : MEASUREMENT_KEYS) {
            String definition = MEASUREMENTS.get(key)[0];
            String unit = MEASUREMENTS.get(key)[1];
            JsonNode fact = Js.or(Js.field(Js.field(supplement, "facts"), key), Js.field(Js.field(catalogue, "facts"), key));
            JsonNode state = Js.field(fact, "state");
            if (Js.truthy(fact) && (Js.is(state, "known") || Js.is(state, "unknown"))
                    && Js.is(Js.field(fact, "definition"), definition) && Js.is(Js.field(fact, "unit"), unit)) {
                facts.set(key, fact.deepCopy());
            } else {
                ObjectNode unknown = unknown("source-evidence-unavailable");
                unknown.put("definition", definition);
                unknown.put("unit", unit);
                facts.set(key, unknown);
            }
        }
        return facts;
    }

    private static ObjectNode equipmentFacts(JsonNode catalogue, JsonNode resolution) {
        JsonNode e = Js.field(catalogue, "equipment");
        ObjectNode node = F.objectNode();
        node.set("definitions", Js.or(copyOrUndefined(Js.field(e, "definitions")), F.arrayNode()));
        ObjectNode available = F.objectNode();
        available.put("state", "unknown");
        available.putNull("codes");
        available.put("completeness", "unknown");
        node.set("available", Js.or(copyOrUndefined(Js.field(e, "available")), available));
        ObjectNode selected = F.objectNode();
        selected.put("state", "unknown");
        selected.putNull("options");
        selected.putNull("accessories");
        selected.put("complete", false);
        selected.put("completeness", "unknown");
        node.set("selected", Js.or(copyOrUndefined(Js.field(e, "selected")), selected));
        ObjectNode fitted = node.putObject("verifiedFitted");
        fitted.put("state", "unknown");
        fitted.putNull("codes");
        fitted.put("reason", "source-does-not-verify-fitting");
        if (Js.truthy(resolution)) node.set("resolution", resolution.deepCopy());
        return node;
    }

    private static JsonNode copyOrUndefined(JsonNode node) {
        return node == null ? null : node.deepCopy();
    }

    private static ObjectNode selectedAppearance(ObjectNode equipment, String category) {
        JsonNode selected = equipment.get("selected");
        ArrayNode selections = F.arrayNode();
        if (Js.is(Js.field(selected, "state"), "known")) {
            JsonNode definitions = equipment.get("definitions");
            if (!definitions.isArray()) throw new IllegalStateException("definitions is not an array");
            JsonNode options = Js.field(selected, "options");
            boolean swatch = Js.truthy(Js.field(equipment.get("resolution"), "resolvedCount"));
            for (JsonNode entry : definitions) {
                if (entry.isNull()) throw new IllegalStateException("definition entry is null");
                if (!Js.is(Js.field(entry, "category"), category) || !includes(options, Js.field(entry, "code"))) continue;
                ObjectNode selection = F.objectNode();
                set(selection, "code", Js.field(entry, "code"));
                selection.set("label", Js.copy(Js.field(entry, "label")));
                selection.put("claim", "selected-catalogue-equipment");
                if (swatch) selection.set("swatch", unknown("source-swatch-unavailable"));
                selections.add(selection);
            }
        }
        ObjectNode node = F.objectNode();
        node.put("state", selections.isEmpty() ? "unknown" : "known");
        node.set("selections", selections);
        if (selections.isEmpty()) node.put("reason", "source-selection-unavailable");
        return node;
    }

    /** Node `options?.includes(code)` for arrays and strings; any other defined type throws as it does there. */
    private static boolean includes(JsonNode options, JsonNode code) {
        if (options == null || options.isNull()) return false;
        if (options.isArray()) {
            for (JsonNode option : options) {
                if (code != null && (code.isNull() ? option.isNull() : Js.strictEquals(option, code))) return true;
            }
            return false;
        }
        if (options.isTextual()) return code != null && code.isTextual() && options.textValue().contains(code.textValue());
        throw new IllegalStateException("options is not searchable");
    }

    /** Node `x || null`. */
    private static JsonNode orNull(JsonNode node) {
        return Js.truthy(node) ? node : NullNode.instance;
    }

    /** Sets a member unless the source member is undefined (Java null). */
    private static void set(ObjectNode node, String key, JsonNode value) {
        if (value != null) node.set(key, value.deepCopy());
    }
}
