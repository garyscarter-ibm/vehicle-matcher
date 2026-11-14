package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** The application contract's structural checks, ported rule for rule from Node application-vehicle-details.js. */
final class ContractChecks {

    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final Pattern DIGEST = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern SWATCH = Pattern.compile("#[a-fA-F0-9]{6}");
    private static final Pattern ORDER_NUMBER = Pattern.compile("[0-9]{7}");
    private static final Set<String> STATES = Set.of("complete", "partial", "unknown");
    private static final String SELECTED_CLAIM = "selected-catalogue-equipment";
    private static final String LITRES = "LITRES";
    private static final List<String> MEASUREMENT_KEYS =
            List.of("seats", "luggageNormal", "luggageExpanded", "acceleration", "bodyLength");
    private static final Map<String, String[]> MEASUREMENTS = Map.of("seats", new String[] {"SEATS", "COUNT"},
            "luggageNormal", new String[] {"NORMAL", LITRES}, "luggageExpanded", new String[] {"EXPANDED", LITRES},
            "acceleration", new String[] {"0–100 KM/H", "SECONDS"}, "bodyLength", new String[] {"BODY LENGTH", "MILLIMETRES"});
    private static final List<String> IDENTITY_KEYS = List.of("kind", "identityKind", "configurationId", "vehicleId",
            "datasetId", "originatingDatasetId", "orderUuid", "orderNumber", "vin", "usage");
    private static final List<String> V2_SELECTED = List.of("state", "options", "accessories", "factoryComplete",
            "accessoryCodesComplete", "accessoryQuantitiesComplete", "provenance");
    private static final List<String> V1_SELECTED =
            List.of("state", "options", "accessories", "complete", "completeness", "provenance");
    private static final List<String> SOURCE_KEYS = List.of("kind", "references", "confidence", "observedDate",
            "retrievedDate", "catalogueDate", "catalogueValidity", "requestedIdentity", "resolvedIdentity",
            "configurationIdentity", "market", "region", "steering", "agModelCode", "vgModelCode", "modelYear",
            "productionEra", "productionDate", "registrationDate", "profile", "profileSources", "profileConfidence",
            "completeVinDecoded", "unresolvedFacts", "identityProvenance");
    private static final List<String> CATALOGUE_DATES =
            List.of("catalogueDate", "effectDate", "orderDate", "productionDate", "taxDate");
    private static final List<String> CATALOGUE_NAMES =
            List.of("agModelCode", "locale", "market", "modelCode", "modelRange", "rawModelRange", "trim");
    private static final List<String> RESOLUTION_KEYS = List.of("version", "digest", "configurationId", "state", "reason",
            "claim", "verifiedFitted", "swatches", "selectedCount", "resolvedCount", "unresolved");

    private ContractChecks() {}

    // ---- JavaScript-shaped primitives -----------------------------------------------------------------------------

    /** Node text(): a string of 1 to 8192 characters. */
    static boolean textOk(String s) {
        return s != null && !s.isEmpty() && s.length() <= 8192;
    }

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && textOk(n.textValue());
    }

    private static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    private static boolean isNull(JsonNode n) {
        return n != null && n.isNull();
    }

    private static boolean nullableText(JsonNode n) {
        return isNull(n) || text(n);
    }

    private static boolean is(JsonNode n, String value) {
        return Js.is(n, value);
    }

    private static boolean bool(JsonNode n, boolean value) {
        return n != null && n.isBoolean() && n.booleanValue() == value;
    }

    private static boolean oneOf(JsonNode n, Set<String> values) {
        return n != null && n.isTextual() && values.contains(n.textValue());
    }

    private static boolean date(JsonNode n) {
        if (isNull(n)) return true;
        if (n == null || !n.isTextual() || !DATE.matcher(n.textValue()).matches()) return false;
        try {
            return LocalDate.parse(n.textValue()).toString().equals(n.textValue());
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    private static boolean datePresent(JsonNode n) {
        return date(n) && !isNull(n);
    }

    private static boolean keys(JsonNode v, List<String> names) {
        if (!object(v)) return false;
        for (Iterator<String> it = v.fieldNames(); it.hasNext(); ) if (!names.contains(it.next())) return false;
        for (String name : names) if (!v.has(name)) return false;
        return true;
    }

    private static boolean only(JsonNode v, List<String> names) {
        if (!object(v)) return false;
        for (Iterator<String> it = v.fieldNames(); it.hasNext(); ) if (!names.contains(it.next())) return false;
        return true;
    }

    private static boolean all(JsonNode array, Predicate<JsonNode> test) {
        for (JsonNode item : array) if (!test.test(item)) return false;
        return true;
    }

    private static boolean array(JsonNode n) {
        return n != null && n.isArray();
    }

    private static boolean stringList(JsonNode n) {
        return array(n) && all(n, ContractChecks::text);
    }

    private static boolean number(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.doubleValue());
    }

    /** Number.isSafeInteger over a JSON number (1.0 is an integer in JavaScript). */
    private static boolean safeInteger(JsonNode n) {
        if (n == null || !n.isNumber()) return false;
        double d = n.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= 9007199254740991.0;
    }

    private static boolean integer(JsonNode n) {
        if (n == null || !n.isNumber()) return false;
        double d = n.doubleValue();
        return Double.isFinite(d) && d == Math.rint(d);
    }

    private static boolean positiveInteger(JsonNode n) {
        return safeInteger(n) && n.doubleValue() > 0;
    }

    /** Node util.isDeepStrictEqual over JSON values: key order is ignored and 1 equals 1.0. */
    static boolean deepEqual(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        if (a.isObject() && b.isObject()) {
            if (a.size() != b.size()) return false;
            for (Iterator<Map.Entry<String, JsonNode>> it = a.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> entry = it.next();
                if (!b.has(entry.getKey()) || !deepEqual(entry.getValue(), b.get(entry.getKey()))) return false;
            }
            return true;
        }
        if (a.isArray() && b.isArray()) {
            if (a.size() != b.size()) return false;
            for (int i = 0; i < a.size(); i++) if (!deepEqual(a.get(i), b.get(i))) return false;
            return true;
        }
        if (a.isContainerNode() || b.isContainerNode()) return false;
        if (a.isNumber() && b.isNumber()) return a.doubleValue() == b.doubleValue();
        return a.equals(b);
    }

    // ---- value rules ----------------------------------------------------------------------------------------------

    private static boolean provenance(JsonNode p) {
        if (!keys(p, List.of("kind", "source", "observedDate")) || !oneOf(p.get("kind"), Set.of("observed", "reference", "unknown"))
                || !date(p.get("observedDate"))) return false;
        JsonNode source = p.get("source");
        if (is(p.get("kind"), "unknown")) return isNull(source) && isNull(p.get("observedDate"));
        boolean cited = (text(source) && SafeReferences.safeV2SourceReference(source.textValue()))
                || (stringList(source) && source.size() > 0 && all(source, s -> SafeReferences.safeV2SourceReference(s.textValue())));
        return cited && !isNull(p.get("observedDate"));
    }

    private static boolean fact(JsonNode f, boolean numeric) {
        List<String> names = numeric ? List.of("state", "value", "reason", "completeness", "provenance", "definition", "unit")
                : List.of("state", "value", "reason", "completeness", "provenance");
        if (!only(f, names) || !oneOf(f.get("state"), Set.of("known", "unknown")) || !oneOf(f.get("completeness"), STATES)
                || !provenance(f.get("provenance"))) return false;
        JsonNode kind = f.get("provenance").get("kind");
        if (is(f.get("state"), "known")) {
            JsonNode value = f.get("value");
            boolean valid = numeric ? number(value) && value.doubleValue() >= 0 : text(value);
            return !is(f.get("completeness"), "unknown") && !is(kind, "unknown") && valid;
        }
        return isNull(f.get("value")) && text(f.get("reason")) && is(f.get("completeness"), "unknown") && is(kind, "unknown");
    }

    private static boolean appearance(JsonNode a) {
        if (!only(a, List.of("state", "selections", "reason")) || !oneOf(a.get("state"), Set.of("known", "unknown"))
                || !array(a.get("selections"))) return false;
        JsonNode selections = a.get("selections");
        boolean sized = is(a.get("state"), "unknown") ? selections.size() == 0 && text(a.get("reason")) : selections.size() > 0;
        return sized && all(selections, s -> only(s, List.of("code", "label", "claim", "swatch")) && text(s.get("code"))
                && fact(s.get("label"), false) && is(s.get("claim"), SELECTED_CLAIM)
                && (s.get("swatch") == null || fact(s.get("swatch"), false) && (is(s.get("swatch").get("state"), "unknown")
                        || s.get("swatch").get("value").isTextual() && SWATCH.matcher(s.get("swatch").get("value").textValue()).matches())));
    }

    private static boolean definitionResolution(JsonNode r) {
        return keys(r, RESOLUTION_KEYS)
                && nullableText(r.get("version")) && nullableText(r.get("digest"))
                && (isNull(r.get("digest")) || DIGEST.matcher(r.get("digest").textValue()).matches())
                && text(r.get("configurationId")) && oneOf(r.get("state"), STATES) && nullableText(r.get("reason"))
                && is(r.get("claim"), SELECTED_CLAIM) && is(r.get("verifiedFitted"), "unknown") && is(r.get("swatches"), "unknown")
                && safeInteger(r.get("selectedCount")) && r.get("selectedCount").doubleValue() >= 0
                && safeInteger(r.get("resolvedCount")) && r.get("resolvedCount").doubleValue() >= 0
                && r.get("resolvedCount").doubleValue() <= r.get("selectedCount").doubleValue() && array(r.get("unresolved"))
                && all(r.get("unresolved"), e -> keys(e, List.of("code", "reason")) && text(e.get("code")) && text(e.get("reason")));
    }

    private static boolean quantity(JsonNode q) {
        if (!keys(q, List.of("state", "value", "reason", "evidenceRefs")) || !array(q.get("evidenceRefs"))
                || q.get("evidenceRefs").size() > 32) return false;
        JsonNode refs = q.get("evidenceRefs");
        if (is(q.get("state"), "known")) {
            return positiveInteger(q.get("value")) && isNull(q.get("reason")) && refs.size() > 0
                    && all(refs, ref -> keys(ref, List.of("evidenceId", "locatorName")) && text(ref.get("evidenceId"))
                            && text(ref.get("locatorName")));
        }
        return is(q.get("state"), "unknown") && isNull(q.get("value")) && is(q.get("reason"), "quantity-not-exposed") && refs.size() == 0;
    }

    private static boolean boundCatalogueIdentity(JsonNode i) {
        return keys(i, List.of("snapshotVersion", "bindingDigest", "configurationId")) && text(i.get("snapshotVersion"))
                && i.get("bindingDigest").isTextual() && DIGEST.matcher(i.get("bindingDigest").textValue()).matches()
                && i.get("configurationId").isTextual()
                && VehicleIdentifiers.canonical("configuration", i.get("configurationId").textValue()) != null;
    }

    private static boolean accessory(JsonNode a, boolean v2) {
        return keys(a, List.of("code", "type", "quantity")) && text(a.get("code")) && is(a.get("type"), "accessory")
                && (v2 ? quantity(a.get("quantity")) : positiveInteger(a.get("quantity")));
    }

    private static boolean equipment(JsonNode e, boolean v2) {
        if (!only(e, List.of("definitions", "available", "selected", "verifiedFitted", "resolution"))
                || (e.has("resolution") && !definitionResolution(e.get("resolution"))) || !array(e.get("definitions"))
                || !all(e.get("definitions"), d -> keys(d, List.of("code", "category", "label")) && text(d.get("code"))
                        && text(d.get("category")) && fact(d.get("label"), false))
                || !only(e.get("available"), List.of("state", "codes", "complete", "completeness", "provenance"))
                || !only(e.get("selected"), v2 ? V2_SELECTED : V1_SELECTED)
                || !keys(e.get("verifiedFitted"), List.of("state", "codes", "reason"))) return false;
        JsonNode selected = e.get("selected");
        JsonNode available = e.get("available");
        boolean validSelected;
        if (v2) {
            JsonNode accessories = selected.get("accessories");
            validSelected = keys(selected, V2_SELECTED) && is(selected.get("state"), "known") && stringList(selected.get("options"))
                    && array(accessories) && bool(selected.get("factoryComplete"), true)
                    && bool(selected.get("accessoryCodesComplete"), true) && all(accessories, a -> accessory(a, true))
                    && selected.get("accessoryQuantitiesComplete") != null && selected.get("accessoryQuantitiesComplete").isBoolean()
                    && selected.get("accessoryQuantitiesComplete").booleanValue() == all(accessories,
                            a -> is(a.get("quantity").get("state"), "known"));
        } else {
            boolean known = is(selected.get("state"), "known");
            validSelected = oneOf(selected.get("state"), Set.of("known", "unknown")) && oneOf(selected.get("completeness"), STATES)
                    && selected.get("complete") != null && selected.get("complete").isBoolean()
                    && (known ? stringList(selected.get("options")) && array(selected.get("accessories"))
                            && all(selected.get("accessories"), a -> accessory(a, false))
                            : isNull(selected.get("options")) && isNull(selected.get("accessories")) && bool(selected.get("complete"), false));
        }
        boolean availableOk;
        if (is(available.get("state"), "known")) availableOk = stringList(available.get("codes"));
        else if (v2) availableOk = array(available.get("codes")) && available.get("codes").size() == 0
                && bool(available.get("complete"), false) && is(available.get("completeness"), "unknown");
        else availableOk = isNull(available.get("codes"));
        JsonNode fitted = e.get("verifiedFitted");
        return oneOf(available.get("state"), Set.of("known", "unknown")) && oneOf(available.get("completeness"), STATES) && availableOk
                && validSelected && (selected.get("provenance") == null || provenance(selected.get("provenance")))
                && (available.get("provenance") == null || provenance(available.get("provenance")))
                && is(fitted.get("state"), "unknown") && isNull(fitted.get("codes"))
                && is(fitted.get("reason"), "source-does-not-verify-fitting");
    }

    private static boolean imageEvidence(JsonNode i) {
        if (!keys(i, List.of("state", "label", "items")) || !array(i.get("items"))) return false;
        JsonNode items = i.get("items");
        boolean labelled = items.size() > 0 ? is(i.get("state"), "representative") && is(i.get("label"), "Representative imagery")
                : is(i.get("state"), "unknown") && is(i.get("label"), "Images unavailable");
        return labelled && all(items, x -> keys(x, List.of("imageId", "asset", "role", "fidelity", "sourceKind", "observedDate", "label"))
                && text(x.get("imageId")) && x.get("asset").isTextual() && SafeReferences.safeReference(x.get("asset").textValue())
                && oneOf(x.get("role"), Set.of("representative-model", "representative-configuration"))
                && Js.strictEquals(x.get("role"), x.get("fidelity")) && is(x.get("sourceKind"), "dated-snapshot")
                && datePresent(x.get("observedDate"))
                && is(x.get("label"), is(x.get("fidelity"), "representative-configuration")
                        ? "Representative configuration image" : "Representative model image"));
    }

    private static boolean catalogueIdentity(JsonNode i) {
        if (boundCatalogueIdentity(i)) return true;
        List<String> names = new java.util.ArrayList<>(CATALOGUE_DATES);
        names.addAll(CATALOGUE_NAMES);
        names.addAll(List.of("selectedOptions", "selectedAccessories"));
        return keys(i, names) && CATALOGUE_DATES.stream().allMatch(k -> datePresent(i.get(k)))
                && CATALOGUE_NAMES.stream().allMatch(k -> text(i.get(k))) && stringList(i.get("selectedOptions"))
                && array(i.get("selectedAccessories")) && all(i.get("selectedAccessories"), a -> accessory(a, false));
    }

    private static boolean sourceEvidence(JsonNode s) {
        if (!keys(s, SOURCE_KEYS) || !oneOf(s.get("kind"), Set.of("dated-snapshot", "north-american-reference"))
                || !stringList(s.get("references"))) return false;
        boolean bound = boundCatalogueIdentity(s.get("resolvedIdentity"));
        for (JsonNode reference : s.get("references")) {
            if (!(bound ? SafeReferences.safeV2SourceReference(reference.textValue())
                    : SafeReferences.safeSourceReference(reference.textValue()))) return false;
        }
        JsonNode config = s.get("configurationIdentity");
        JsonNode provenance = s.get("identityProvenance");
        if (s.get("references").size() == 0 || !text(s.get("confidence"))
                || !List.of("observedDate", "retrievedDate", "catalogueDate", "productionDate", "registrationDate").stream()
                        .allMatch(k -> date(s.get(k)))
                || isNull(s.get("observedDate")) || !text(s.get("market")) || !bool(s.get("completeVinDecoded"), false)
                || !List.of("region", "steering", "agModelCode", "vgModelCode", "productionEra", "profileConfidence").stream()
                        .allMatch(k -> nullableText(s.get(k)))
                || !(isNull(s.get("modelYear")) || integer(s.get("modelYear"))) || !stringList(s.get("unresolvedFacts"))
                || !keys(config, List.of("vgModelCode", "agModelCode", "factoryOptionCodes", "provenance"))
                || !text(config.get("vgModelCode")) || !nullableText(config.get("agModelCode"))
                || !stringList(config.get("factoryOptionCodes")) || !keys(provenance, List.of("kind", "source", "observedDate"))
                || !oneOf(provenance.get("kind"), Set.of("synthetic", "observed")) || !text(provenance.get("source"))
                || !date(provenance.get("observedDate")) || !deepEqual(provenance, config.get("provenance"))) return false;
        JsonNode requested = s.get("requestedIdentity");
        JsonNode resolved = s.get("resolvedIdentity");
        JsonNode profile = s.get("profile");
        JsonNode sources = s.get("profileSources");
        JsonNode validity = s.get("catalogueValidity");
        return (isNull(requested) || catalogueIdentity(requested)) && (isNull(resolved) || catalogueIdentity(resolved))
                && (isNull(profile) || keys(profile, List.of("profileId", "profileVersion", "registryVersion", "referenceOnly"))
                        && List.of("profileId", "profileVersion", "registryVersion").stream().allMatch(k -> text(profile.get(k)))
                        && profile.get("referenceOnly").isBoolean())
                && (isNull(sources) || array(sources) && all(sources, p -> keys(p, List.of("id", "kind", "scope", "source", "observedDate", "sourceDate"))
                        && List.of("id", "kind", "scope").stream().allMatch(k -> text(p.get(k)))
                        && SafeReferences.safeSourceReference(p.get("source")) && date(p.get("observedDate")) && date(p.get("sourceDate"))))
                && (isNull(validity) || keys(validity, List.of("effectDate", "orderDate", "productionDate", "taxDate"))
                        && all(validity, ContractChecks::datePresent));
    }

    // ---- the success envelope -------------------------------------------------------------------------------------

    static boolean validSuccess(JsonNode w) {
        if (!object(w) || !oneOf(w.get("status"), Set.of("complete", "partial")) || !isNull(w.get("failure"))
                || !keys(w.get("requested"), List.of("kind", "id")) || !keys(w.get("resolved"), List.of("kind", "id", "configurationId"))
                || !keys(w.get("identity"), IDENTITY_KEYS) || !oneOf(w.get("identity").get("kind"), Set.of("configuration", "stock", "vin"))
                || !text(w.get("identity").get("identityKind")) || !validConfiguration(w.get("identity").get("configurationId"))
                || !text(w.get("identity").get("datasetId")) || !text(w.get("identity").get("originatingDatasetId"))
                || !List.of("vehicleId", "orderUuid", "orderNumber", "vin").stream().allMatch(k -> nullableText(w.get("identity").get(k)))
                || !keys(w.get("versions"), List.of("corpus", "manifestDigest", "snapshot", "profileRegistry", "generator"))
                || !List.of("corpus", "manifestDigest", "snapshot").stream().allMatch(k -> text(w.get("versions").get(k)))
                || !List.of("profileRegistry", "generator").stream().allMatch(k -> nullableText(w.get("versions").get(k)))) return false;
        JsonNode d = w.get("description");
        if (!keys(d, List.of("model", "derivative", "generation", "bodyType", "powertrain", "paint", "upholstery"))
                || !List.of("model", "derivative", "generation", "bodyType").stream().allMatch(k -> fact(d.get(k), false))
                || !keys(d.get("powertrain"), List.of("fuel", "drive", "transmission", "engine"))
                || !all(d.get("powertrain"), f -> fact(f, false)) || !appearance(d.get("paint")) || !appearance(d.get("upholstery"))
                || !keys(w.get("technical"), MEASUREMENT_KEYS)) return false;
        for (String key : MEASUREMENT_KEYS) {
            JsonNode technical = w.get("technical").get(key);
            if (!fact(technical, true) || !is(technical.get("definition"), MEASUREMENTS.get(key)[0])
                    || !is(technical.get("unit"), MEASUREMENTS.get(key)[1])) return false;
        }
        JsonNode source = w.get("source");
        JsonNode images = w.get("images");
        if (!equipment(w.get("equipment"), boundCatalogueIdentity(Js.field(source, "resolvedIdentity"))) || !imageEvidence(images)
                || !sourceEvidence(source)) return false;
        JsonNode completeness = w.get("completeness");
        JsonNode presentation = w.get("presentation");
        JsonNode routing = w.get("routing");
        return keys(completeness, List.of("record", "selectedOptions", "measurements", "optionDefinitions", "availableOptions",
                        "verifiedFitted", "images"))
                && Js.strictEquals(completeness.get("record"), w.get("status")) && is(completeness.get("verifiedFitted"), "unknown")
                && List.of("selectedOptions", "measurements", "optionDefinitions", "availableOptions").stream()
                        .allMatch(k -> oneOf(completeness.get(k), STATES))
                && Js.strictEquals(completeness.get("images"), images.get("state"))
                && keys(presentation, List.of("syntheticLabel", "associationLabel", "sourceLabel", "verifiedFittedLabel",
                        "unknownLabel", "imageLabel"))
                && is(presentation.get("syntheticLabel"), "Vehicle identity") && text(presentation.get("associationLabel"))
                && is(presentation.get("verifiedFittedLabel"), "VIN-fitted equipment unknown")
                && is(presentation.get("unknownLabel"), "Unknown")
                && is(presentation.get("sourceLabel"), is(source.get("kind"), "dated-snapshot")
                        ? "Dated catalogue snapshot" : "North American structural reference")
                && Js.strictEquals(presentation.get("imageLabel"), images.get("label"))
                && is(Js.field(routing, "mode"), "offline") && bool(Js.field(routing, "liveEligible"), false);
    }

    private static boolean validConfiguration(JsonNode id) {
        return id != null && id.isTextual() && VehicleIdentifiers.canonical("configuration", id.textValue()) != null;
    }

    /** The provider answer must be about exactly the trusted request and its pins. */
    static boolean matches(EvidenceRequest request, JsonNode w) {
        JsonNode identity = w.get("identity");
        JsonNode source = w.get("source");
        String kind = request.kind();
        if (!is(w.get("requested").get("kind"), kind) || !is(w.get("requested").get("id"), request.id())
                || !is(w.get("resolved").get("kind"), kind) || !is(w.get("resolved").get("id"), request.id())
                || !is(identity.get("kind"), kind) || !is(identity.get("identityKind"), "synthetic")
                || !Js.strictEquals(w.get("resolved").get("configurationId"), identity.get("configurationId"))) return false;
        JsonNode resolution = Js.field(w.get("equipment"), "resolution");
        if (Js.truthy(resolution) && !Js.strictEquals(resolution.get("configurationId"), identity.get("configurationId"))) return false;
        if ("configuration".equals(kind) && (!is(identity.get("configurationId"), request.id()) || !isNull(identity.get("vehicleId"))
                || !isNull(identity.get("vin")) || !isNull(identity.get("orderUuid")) || !isNull(identity.get("orderNumber"))
                || !is(identity.get("usage"), "configuration"))) return false;
        if ("stock".equals(kind) && (!is(identity.get("orderUuid"), request.id()) || !orderNumber(identity.get("orderNumber"))
                || !text(identity.get("vehicleId")) || !isNull(identity.get("vin")) || !is(identity.get("usage"), "stock"))) return false;
        if ("vin".equals(kind) && (!is(identity.get("vin"), request.id()) || !text(identity.get("vehicleId"))
                || !isNull(identity.get("orderUuid")) || !isNull(identity.get("orderNumber"))
                || !(is(identity.get("usage"), "current-car") || is(identity.get("usage"), "delivered-car")))) return false;
        JsonNode resolved = source.get("resolvedIdentity");
        if (!deepEqual(source.get("requestedIdentity"), resolved)) return false;
        JsonNode config = source.get("configurationIdentity");
        StringBuilder codes = new StringBuilder();
        for (JsonNode code : config.get("factoryOptionCodes")) codes.append(codes.length() == 0 ? "" : ",").append(code.textValue());
        String signature = config.get("vgModelCode").textValue() + ":" + codes;
        if (!Base64.getEncoder().encodeToString(signature.getBytes(StandardCharsets.UTF_8)).equals(identity.get("configurationId").textValue())) {
            return false;
        }
        JsonNode selectedOptions = w.get("equipment").get("selected").get("options");
        if (boundCatalogueIdentity(resolved)) {
            if (!Js.strictEquals(resolved.get("configurationId"), identity.get("configurationId"))
                    || !Js.strictEquals(resolved.get("snapshotVersion"), w.get("versions").get("snapshot"))
                    || !deepEqual(config.get("factoryOptionCodes"), selectedOptions)) return false;
        } else if (Js.truthy(resolved)) {
            JsonNode validity = source.get("catalogueValidity");
            if (!Js.strictEquals(resolved.get("modelCode"), source.get("vgModelCode"))
                    || !Js.strictEquals(resolved.get("market"), source.get("market"))
                    || !Js.strictEquals(resolved.get("agModelCode"), source.get("agModelCode"))
                    || !Js.strictEquals(resolved.get("catalogueDate"), source.get("catalogueDate"))
                    || !deepEqual(resolved.get("selectedOptions"), selectedOptions)) return false;
            for (String k : List.of("effectDate", "orderDate", "productionDate", "taxDate")) {
                if (!Js.strictEquals(resolved.get(k), Js.field(validity, k))) return false;
            }
        }
        return pinsMatch(request.expected(), w);
    }

    private static boolean orderNumber(JsonNode n) {
        return n != null && n.isTextual() && ORDER_NUMBER.matcher(n.textValue()).matches();
    }

    private static boolean pinsMatch(Map<String, String> expected, JsonNode w) {
        if (expected == null) return true;
        JsonNode i = w.get("identity");
        JsonNode s = w.get("source");
        JsonNode v = w.get("versions");
        JsonNode d = w.get("description");
        JsonNode validity = s.get("catalogueValidity");
        for (Map.Entry<String, String> pin : expected.entrySet()) {
            JsonNode actual = switch (pin.getKey()) {
                case "configurationId" -> i.get("configurationId");
                case "vehicleId" -> i.get("vehicleId");
                case "datasetId" -> i.get("datasetId");
                case "originatingDatasetId" -> i.get("originatingDatasetId");
                case "corpusVersion" -> v.get("corpus");
                case "snapshotVersion" -> v.get("snapshot");
                case "profileId" -> Js.field(s.get("profile"), "profileId");
                case "market" -> s.get("market");
                case "model" -> d.get("model").get("value");
                case "bodyType" -> d.get("bodyType").get("value");
                case "powertrain" -> d.get("powertrain").get("fuel").get("value");
                case "agModelCode" -> s.get("agModelCode");
                case "vgModelCode" -> s.get("vgModelCode");
                case "observedDate" -> s.get("observedDate");
                case "catalogueDate" -> s.get("catalogueDate");
                case "productionDate" -> s.get("productionDate");
                case "registrationDate" -> s.get("registrationDate");
                case "effectDate" -> Js.field(validity, "effectDate");
                case "orderDate" -> Js.field(validity, "orderDate");
                case "taxDate" -> Js.field(validity, "taxDate");
                default -> null;
            };
            if (actual == null || !actual.isTextual() || !actual.textValue().equals(pin.getValue())) return false;
        }
        return true;
    }
}
