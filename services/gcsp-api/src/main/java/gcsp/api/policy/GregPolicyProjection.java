package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Greg's policy controls: the read projection and change-set validation, ported from server/gcsp/greg/publish. */
final class GregPolicyProjection {

    static final String RECOMMENDATION = "employee.recommendation.v1";
    static final String HISTORY = "Published versions preserve existing quotes and offers.";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final long MAX_SAFE = 9007199254740991L;
    private static final List<String> PROVENANCE = List.of("source", "sourceDate", "basis", "status", "unit");
    private static final Set<String> PUBLISH_KEYS =
            Set.of("expectedActiveVersion", "changes", "commandId", "policyVersion", "effectiveFrom");

    /** A recommendation policy that is missing or malformed: the read is unavailable, as Node throws. */
    static final class Unavailable extends RuntimeException {
        Unavailable(String message) {
            super(message, null, false, false);
        }
    }

    /** Exactly one is non-null: the invalid outcome, or the table changes to publish. */
    record Prepared(PolicyResult error, ArrayNode changes) {
    }

    private GregPolicyProjection() {
    }

    static boolean text(JsonNode node) {
        return node != null && node.isTextual() && text(node.textValue());
    }

    static boolean text(String value) {
        return PolicyTime.text(value) && value.length() <= 256;
    }

    private static long millis(JsonNode instant) {
        return PolicyTime.parse(instant.textValue()).getAsLong();
    }

    private static boolean effective(JsonNode row, long now) {
        return millis(row.get("effectiveFrom")) <= now
                && (!row.has("effectiveTo") || now < millis(row.get("effectiveTo")));
    }

    private static JsonNode assumption(ObjectNode seed, String key, long now) {
        for (JsonNode row : seed.get("assumptions")) {
            if (key.equals(row.path("key").asText(null)) && effective(row, now)) {
                return row;
            }
        }
        return null;
    }

    private static JsonNode labelsOf(ObjectNode seed, String key, long now) {
        JsonNode row = assumption(seed, key, now);
        JsonNode value = row == null ? null : row.get("value");
        return value != null && value.isObject() ? value : JSON.objectNode();
    }

    private static String named(JsonNode map, String key) {
        JsonNode entry = map != null && map.isObject() && key != null ? map.get(key) : null;
        return text(entry) ? entry.textValue() : null;
    }

    /** Plain version name: known id parts by name, Greg's own publications as "Greg's change", else "Unnamed update". */
    static String versionLabel(String id, JsonNode versions) {
        List<String> labels = new ArrayList<>();
        for (String part : id.split("\\+", -1)) {
            String name = named(versions, part);
            labels.add(name != null ? name : part.startsWith("greg-") ? "Greg's change" : "Unnamed update");
        }
        return String.join(" with ", labels);
    }

    private static String priceLabel(JsonNode row, JsonNode models) {
        if (row.hasNonNull("configurationId")) {
            return row.get("configurationId").asText().replace("|", " ");
        }
        String[] parts = row.path("matchValue").asText("").split("\\|", -1);
        String engine = String.join("|", java.util.Arrays.copyOfRange(parts, 1, parts.length));
        String template = named(models, parts[0]);
        String label = template == null ? parts[0] + " " + engine : template.replaceFirst("\\{engine}",
                java.util.regex.Matcher.quoteReplacement(engine));
        return label.strip();
    }

    private static void provenance(ObjectNode target, JsonNode row) {
        for (String key : PROVENANCE) {
            if (row.has(key)) {
                target.set(key, row.get(key).deepCopy());
            }
        }
    }

    private static boolean safe(JsonNode node) {
        if (node == null || !node.isNumber()) {
            return false;
        }
        double value = node.doubleValue();
        return Double.isFinite(value) && Math.floor(value) == value && Math.abs(value) <= MAX_SAFE;
    }

    private static ObjectNode editorRanges(ObjectNode seed, long now) {
        ObjectNode ranges = JSON.objectNode();
        JsonNode row = assumption(seed, "greg.publish.editor.v1", now);
        if (row == null) {
            return ranges;
        }
        for (String kind : List.of("price", "weight")) {
            JsonNode range = row.path("value").get(kind);
            if (range != null && range.isObject() && safe(range.get("minimum")) && safe(range.get("maximum"))
                    && safe(range.get("step")) && range.get("minimum").longValue() >= 0
                    && range.get("maximum").longValue() > range.get("minimum").longValue()
                    && range.get("step").longValue() == 1) {
                ObjectNode copy = ((ObjectNode) range).deepCopy();
                copy.put("assumptionKey", row.get("key").textValue());
                provenance(copy, row);
                ranges.set(kind, copy);
            }
        }
        return ranges;
    }

    /** The editable price and weight fields effective at the instant; a missing recommendation policy is unavailable. */
    static ArrayNode fields(ObjectNode seed, long now) {
        ObjectNode ranges = editorRanges(seed, now);
        JsonNode display = labelsOf(seed, "policy.displayLabels.v1", now);
        JsonNode schemes = labelsOf(seed, "scheme.displayNames.v1", now).get("names");
        JsonNode calibration = assumption(seed, RECOMMENDATION, now);
        if (calibration == null) {
            throw new Unavailable("Missing recommendation policy");
        }
        JsonNode preferences = calibration.path("value").path("preferences");
        boolean adoptionRequired = !calibration.path("value").has("preferenceWeights");
        Map<String, JsonNode> weights = new LinkedHashMap<>();
        JsonNode supplied = calibration.path("value").get("preferenceWeights");
        if (!adoptionRequired && (!supplied.isObject() || supplied.size() != preferences.size())) {
            throw new Unavailable("Invalid weights");
        }
        Iterator<String> keys = preferences.fieldNames();
        while (keys.hasNext()) {
            String key = keys.next();
            JsonNode weight = adoptionRequired ? JSON.numberNode(1) : supplied.get(key);
            if (!safe(weight) || weight.doubleValue() < 0) {
                throw new Unavailable("Invalid weights");
            }
            weights.put(key, weight);
        }
        ArrayNode out = JSON.arrayNode();
        for (JsonNode row : seed.get("pricePlans")) {
            if (!effective(row, now)) {
                continue;
            }
            ObjectNode field = out.addObject();
            field.put("id", "price:" + row.get("key").textValue());
            field.put("kind", "price");
            if (ranges.has("price")) {
                field.set("presentationRange", ranges.get("price").deepCopy());
            }
            field.set("key", row.get("key").deepCopy());
            field.set("value", row.get("monthlyPoints").deepCopy());
            provenance(field, row);
            field.set("schemeId", row.get("schemeId").deepCopy());
            field.put("label", priceLabel(row, display.get("models")));
            String unit = row.path("unit").asText(null);
            String unitLabel = named(display.get("units"), unit);
            if (unit != null) {
                field.put("unitLabel", unitLabel != null ? unitLabel : unit);
            }
            String scheme = named(schemes, row.path("schemeId").asText(null));
            field.put("schemeLabel", scheme != null ? scheme : row.path("schemeId").asText());
            if (row.hasNonNull("configurationId")) {
                field.set("configurationId", row.get("configurationId").deepCopy());
            } else {
                field.set("matchField", row.get("matchField").deepCopy());
                field.set("matchValue", row.get("matchValue").deepCopy());
            }
            field.put("step", 1);
            field.put("minimum", 0);
        }
        for (Map.Entry<String, JsonNode> weight : weights.entrySet()) {
            String key = weight.getKey();
            ObjectNode field = out.addObject();
            field.put("id", "weight:" + key);
            field.put("kind", "weight");
            if (ranges.has("weight")) {
                field.set("presentationRange", ranges.get("weight").deepCopy());
            }
            field.put("key", key);
            field.set("value", weight.getValue().deepCopy());
            provenance(field, calibration);
            field.put("unit", "relative-weight");
            String unitLabel = named(display.get("units"), "relative-weight");
            field.put("unitLabel", unitLabel != null ? unitLabel : "relative-weight");
            String name = named(display.get("weights"), key);
            field.put("label", (name != null ? name : key.substring(0, 1).toUpperCase() + key.substring(1)) + " weight");
            field.put("step", 1);
            field.put("minimum", 0);
            field.put("adoptionRequired", adoptionRequired);
        }
        return out;
    }

    /** The unknown-count summary: Java has no offers, holds or quotes tables yet. */
    static ObjectNode heldOffersUnknown() {
        ObjectNode held = JSON.objectNode();
        held.putNull("count");
        held.put("unit", "offers");
        held.put("message", "Refresh to see active offers keeping their earlier terms.");
        return held;
    }

    /** The readPolicy value for the active version's snapshot at the instant. Java has no clockVersion yet. */
    static ObjectNode project(ObjectNode seed, String nowIso) {
        long now = PolicyTime.parse(nowIso).getAsLong();
        JsonNode names = labelsOf(seed, "policy.displayLabels.v1", now).get("versions");
        ObjectNode versionNames = names != null && names.isObject() ? (ObjectNode) names.deepCopy() : JSON.objectNode();
        ObjectNode value = JSON.objectNode();
        value.put("state", "draft");
        value.set("activeVersion", seed.get("policyVersion").deepCopy());
        value.put("activeVersionLabel", versionLabel(seed.get("policyVersion").textValue(), names));
        value.set("versionNames", versionNames);
        value.set("effectiveFrom", seed.get("effectiveFrom").deepCopy());
        value.put("asOf", nowIso);
        value.set("fields", fields(seed, now));
        value.put("weightsAdoptionRequired", !assumptionAny(seed, RECOMMENDATION).path("value").has("preferenceWeights"));
        value.set("heldOffers", heldOffersUnknown());
        value.put("historyMessage", HISTORY);
        return value;
    }

    private static JsonNode assumptionAny(ObjectNode seed, String key) {
        for (JsonNode row : seed.get("assumptions")) {
            if (key.equals(row.path("key").asText(null))) {
                return row;
            }
        }
        throw new Unavailable("Missing recommendation policy");
    }

    private static PolicyResult invalid(String code, String field, String reason) {
        ObjectNode f = PolicyBodies.fields();
        f.put("code", code);
        f.put("accepted", false);
        f.putArray("reasons").addObject().put("field", field).put("reason", reason);
        return PolicyBodies.result("invalid", null, f);
    }

    private static boolean onlyKeys(JsonNode node, Set<String> allowed) {
        if (node == null || !node.isObject()) {
            return false;
        }
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            if (!allowed.contains(names.next())) {
                return false;
            }
        }
        return true;
    }

    /** Node changesFor(publishing=true): validates the body against the pinned base and builds the table patches. */
    static Prepared changesFor(ObjectNode base, long now, JsonNode input) {
        if (!onlyKeys(input, PUBLISH_KEYS) || !text(input.get("expectedActiveVersion"))
                || input.get("changes") == null || !input.get("changes").isArray() || input.get("changes").isEmpty()
                || input.get("changes").size() > 100 || !text(input.get("commandId")) || !text(input.get("policyVersion"))
                || !input.path("effectiveFrom").isTextual() || !PolicyTime.validInstant(input.get("effectiveFrom").textValue())
                || millis(input.get("effectiveFrom")) > now) {
            return new Prepared(invalid("invalid-change-set", "changeSet", "Supply the active version and 1 to 100 "
                    + "editable changes; new publication takes effect at the current time; retries retain that instant."), null);
        }
        long editTime = millis(input.get("effectiveFrom"));
        ArrayNode editable;
        try {
            editable = fields(base, editTime);
        } catch (Unavailable e) {
            return new Prepared(PolicyBodies.unavailable(), null);
        }
        Set<String> seen = new HashSet<>();
        Map<String, ObjectNode> patches = new LinkedHashMap<>();
        int differences = 0;
        for (JsonNode change : input.get("changes")) {
            JsonNode field = null;
            if (change != null && change.isObject() && change.path("id").isTextual()) {
                for (JsonNode candidate : editable) {
                    if (candidate.get("id").textValue().equals(change.get("id").textValue())) {
                        field = candidate;
                    }
                }
            }
            JsonNode value = change == null ? null : change.get("value");
            if (!onlyKeys(change, Set.of("id", "value")) || field == null || !seen.add(change.get("id").textValue())
                    || !safe(value) || value.doubleValue() < 0) {
                return new Prepared(invalid("invalid-editable-field", "changes",
                        "Use each published price or recommendation weight once, with a nonnegative safe integer."), null);
            }
            if (value.doubleValue() == field.get("value").doubleValue()) {
                continue;
            }
            differences++;
            String key = field.get("key").textValue();
            if ("price".equals(field.get("kind").textValue())) {
                ObjectNode patch = JSON.objectNode();
                patch.put("monthlyPoints", value.longValue());
                patch.put("value", value.longValue());
                patches.put(key, tableChange("pricePlans", key, patch));
            } else {
                ObjectNode entry = patches.computeIfAbsent(RECOMMENDATION, k -> {
                    ObjectNode patch = JSON.objectNode();
                    patch.set("value", assumptionAny(base, RECOMMENDATION).get("value").deepCopy());
                    return tableChange("assumptions", RECOMMENDATION, patch);
                });
                ObjectNode next = (ObjectNode) entry.get("patch").get("value");
                if (!next.has("preferenceWeights")) {
                    ObjectNode neutral = next.putObject("preferenceWeights");
                    next.get("preferences").fieldNames().forEachRemaining(name -> neutral.put(name, 1));
                }
                ((ObjectNode) next.get("preferenceWeights")).put(key, value.longValue());
            }
        }
        if (differences == 0) {
            return new Prepared(invalid("no-policy-change", "changes", "Change at least one published value."), null);
        }
        String date = Instant.ofEpochMilli(editTime).toString().substring(0, 10);
        ArrayNode changes = JSON.arrayNode();
        for (ObjectNode change : patches.values()) {
            ObjectNode patch = (ObjectNode) change.get("patch");
            patch.put("source", "greg-policy-publish");
            patch.put("sourceDate", date);
            patch.put("status", "assumed");
            patch.put("basis", "Greg adjusted this points or preference-weight assumption.");
            changes.add(change);
        }
        return new Prepared(null, changes);
    }

    private static ObjectNode tableChange(String table, String key, ObjectNode patch) {
        ObjectNode change = JSON.objectNode();
        change.put("table", table);
        change.put("key", key);
        change.set("patch", patch);
        return change;
    }
}
