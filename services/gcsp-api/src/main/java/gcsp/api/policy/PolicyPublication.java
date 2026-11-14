package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Pure port of server/gcsp/policy/publish.js: change-set validation and successor construction. */
final class PolicyPublication {

    static final List<String> TABLES =
            List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions");
    private static final Set<String> CHANGE_SET_KEYS =
            Set.of("commandId", "expectedActiveVersion", "policyVersion", "effectiveFrom", "changes");
    private static final Set<String> CHANGE_KEYS = Set.of("table", "key", "patch");
    private static final Set<String> PROTECTED = Set.of("key", "policyVersion", "effectiveFrom", "effectiveTo", "linkId",
            "ruleId", "pricePlanId", "priceEntryId", "allowanceId");
    private static final long MAX_SAFE = 9007199254740991L;

    /** Either a refusal outcome, or the successor ready to complete (exactly one is non-null). */
    record Successor(PolicyResult outcome, ObjectNode next, ObjectNode predecessor) {
    }

    /** The accepted successor and its body. */
    record Published(PolicyResult outcome, ObjectNode seed, String publishedAt, String sourceVersion) {
    }

    private PolicyPublication() {
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && PolicyTime.text(node.textValue()) && node.textValue().length() <= 256;
    }

    private static boolean object(JsonNode node) {
        return node != null && node.isObject();
    }

    /** Null when the change set is well formed, else the invalid outcome. */
    static PolicyResult validateChangeSet(JsonNode input) {
        if (!object(input) || anyKeyOutside(input, CHANGE_SET_KEYS) || !text(input.get("commandId"))
                || !text(input.get("expectedActiveVersion")) || !text(input.get("policyVersion"))
                || !validInstant(input.get("effectiveFrom")) || !input.has("changes") || !input.get("changes").isArray() || input.get("changes").size() == 0
                || input.get("changes").size() > 100) {
            return PolicyBodies.invalid("changeSet", "Supply commandId, expectedActiveVersion, new policyVersion, "
                    + "ISO effectiveFrom and 1 to 100 changes.");
        }
        Set<String> seen = new HashSet<>();
        for (JsonNode change : input.get("changes")) {
            String table = change != null && change.isObject() && change.get("table") != null
                    && change.get("table").isTextual() ? change.get("table").textValue() : null;
            if (!object(change) || anyKeyOutside(change, CHANGE_KEYS) || table == null || !TABLES.contains(table)
                    || !text(change.get("key")) || !object(change.get("patch")) || change.get("patch").size() == 0
                    || seen.contains(table + "\u0000" + change.get("key").textValue())) {
                return PolicyBodies.invalid("changes",
                        "Each change names one existing collection/key and a nonempty patch, without duplicates.");
            }
            seen.add(table + "\u0000" + change.get("key").textValue());
            JsonNode patch = change.get("patch");
            for (String field : List.of("basis", "source", "sourceDate", "status")) {
                if (!text(patch.get(field))) {
                    return PolicyBodies.invalid("changes.provenance", "Every changed entry requires basis, source, "
                            + "sourceDate and assumed, verified or observed aggregate status.");
                }
            }
        }
        return null;
    }

    private static boolean validInstant(JsonNode node) {
        return node != null && node.isTextual() && PolicyTime.validInstant(node.textValue());
    }

    private static boolean anyKeyOutside(JsonNode node, Set<String> allowed) {
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            if (!allowed.contains(names.next())) {
                return true;
            }
        }
        return false;
    }

    /** The version active at now, by the latest effectiveFrom, or null. */
    private static ObjectNode activeAt(List<ObjectNode> seeds, long now) {
        ObjectNode best = null;
        long bestFrom = Long.MIN_VALUE;
        for (ObjectNode seed : seeds) {
            long from = millis(seed.get("effectiveFrom"));
            boolean open = !seed.has("effectiveTo") || now < millis(seed.get("effectiveTo"));
            if (from <= now && open && (best == null || from > bestFrom)) {
                best = seed;
                bestFrom = from;
            }
        }
        return best;
    }

    private static long millis(JsonNode instant) {
        return PolicyTime.parse(instant.textValue()).getAsLong();
    }

    /** Stale-version, effective-date and successor-copy rules; the receipt handles command replay. */
    static Successor prepareSuccessor(List<ObjectNode> seeds, JsonNode input, String now) {
        long nowMillis = PolicyTime.parse(now).getAsLong();
        ObjectNode active = activeAt(seeds, nowMillis);
        String expected = input.get("expectedActiveVersion").textValue();
        if (active == null || !active.get("policyVersion").textValue().equals(expected)) {
            return new Successor(PolicyBodies.stale(expected,
                    active == null ? null : active.get("policyVersion").textValue()), null, null);
        }
        String version = input.get("policyVersion").textValue();
        long from = millis(input.get("effectiveFrom"));
        boolean taken = false;
        boolean notLater = false;
        for (ObjectNode seed : seeds) {
            taken |= seed.get("policyVersion").textValue().equals(version);
            notLater |= millis(seed.get("effectiveFrom")) >= from;
        }
        if (taken || from < nowMillis || notLater) {
            return new Successor(PolicyBodies.invalid("effectiveFrom",
                    "Use a new version and an effective date at or after now, later than every retained version."),
                    null, null);
        }
        // Append to the latest scheduled snapshot so a later publication cannot discard its changes.
        ObjectNode predecessor = seeds.stream()
                .max(Comparator.comparingLong((ObjectNode seed) -> millis(seed.get("effectiveFrom")))).orElseThrow();
        ObjectNode next = predecessor.deepCopy();
        next.put("policyVersion", version);
        next.put("effectiveFrom", input.get("effectiveFrom").textValue());
        next.remove("effectiveTo");
        for (String table : TABLES) {
            for (JsonNode row : next.get(table)) {
                ((ObjectNode) row).put("policyVersion", version);
            }
        }
        return new Successor(null, next, predecessor);
    }

    /** Validates the whole changed policy, then builds the accepted outcome. */
    static Published completePublication(List<ObjectNode> seeds, Successor successor, String publisher, String now,
            JsonNode adoption) {
        List<JsonNode> all = new ArrayList<>(seeds);
        all.add(successor.next());
        try {
            PolicyValidation.snapshot(all);
        } catch (PolicySourceException e) {
            return new Published(PolicyBodies.invalid("changes", "The complete changed policy must satisfy the seed "
                    + "schema, dates, references, units and provenance."), null, null, null);
        }
        ObjectNode next = successor.next();
        PolicyResult outcome = PolicyBodies.accepted(next.get("policyVersion").textValue(),
                next.get("effectiveFrom").textValue(), publisher, now, adoption);
        return new Published(outcome, next, now, successor.predecessor().get("policyVersion").textValue());
    }

    /** Applies the patches to the successor and completes it; a refusal carries only the outcome. */
    static Published preparePublication(List<ObjectNode> seeds, JsonNode input, String publisher, String now) {
        Successor prepared = prepareSuccessor(seeds, input, now);
        if (prepared.outcome() != null) {
            return new Published(prepared.outcome(), null, null, null);
        }
        ObjectNode next = prepared.next();
        for (JsonNode change : input.get("changes")) {
            String table = change.get("table").textValue();
            String key = change.get("key").textValue();
            ObjectNode patch = (ObjectNode) change.get("patch");
            ObjectNode row = row(next, table, key);
            if (row == null || fieldOutside(patch, row)) {
                return new Published(PolicyBodies.invalid("changes.patch",
                        "Patch an existing entry field; identifiers and effective dates are immutable."), null, null, null);
            }
            if (patch.has("value") && !validValue(patch.get("value"), row.get("value"))
                    && !validPreferenceWeightAdoption(table, key, patch, row.get("value"))) {
                return new Published(PolicyBodies.invalid("changes.value",
                        "Preserve the existing value type and shape, with finite nonnegative numbers."), null, null, null);
            }
            patch.fields().forEachRemaining(field -> row.set(field.getKey(), field.getValue().deepCopy()));
            row.put("effectiveFrom", input.get("effectiveFrom").textValue());
        }
        return completePublication(seeds, prepared, publisher, now, null);
    }

    private static ObjectNode row(ObjectNode next, String table, String key) {
        for (JsonNode entry : next.get(table)) {
            if (entry.has("key") && entry.get("key").isTextual() && key.equals(entry.get("key").textValue())) {
                return (ObjectNode) entry;
            }
        }
        return null;
    }

    private static boolean fieldOutside(ObjectNode patch, ObjectNode row) {
        Iterator<String> names = patch.fieldNames();
        while (names.hasNext()) {
            String field = names.next();
            if (PROTECTED.contains(field) || !row.has(field)) {
                return true;
            }
        }
        return false;
    }

    private static String type(JsonNode node) {
        if (node.isNull()) {
            return "null";
        }
        if (node.isNumber()) {
            return "number";
        }
        if (node.isTextual()) {
            return "string";
        }
        if (node.isBoolean()) {
            return "boolean";
        }
        return "object";
    }

    private static boolean integer(JsonNode node) {
        double v = node.doubleValue();
        return Double.isFinite(v) && Math.floor(v) == v;
    }

    private static boolean safeInteger(JsonNode node) {
        return node != null && node.isNumber() && integer(node) && Math.abs(node.doubleValue()) <= MAX_SAFE;
    }

    /** The value keeps the previous type and shape, with finite nonnegative numbers. */
    static boolean validValue(JsonNode value, JsonNode previous) {
        if (value == null || previous == null) {
            return false;
        }
        if (value.isNull() || previous.isNull()) {
            return value.isNull() && previous.isNull();
        }
        if (!type(value).equals(type(previous))) {
            return false;
        }
        if (value.isNumber()) {
            double v = value.doubleValue();
            return Double.isFinite(v) && v >= 0 && (!integer(previous) || safeInteger(value));
        }
        if (value.isTextual() || value.isBoolean()) {
            return true;
        }
        if (previous.isArray()) {
            if (!value.isArray()) {
                return false;
            }
            for (JsonNode entry : value) {
                boolean any = false;
                for (JsonNode sample : previous) {
                    if (validValue(entry, sample)) {
                        any = true;
                        break;
                    }
                }
                if (!any) {
                    return false;
                }
            }
            return true;
        }
        if (previous.isObject()) {
            if (!value.isObject() || value.size() != previous.size()) {
                return false;
            }
            Iterator<String> names = previous.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                if (!value.has(name) || !validValue(value.get(name), previous.get(name))) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /** A dated successor may adopt neutral employee preference multipliers without rewriting retained v1. */
    static boolean validPreferenceWeightAdoption(String table, String key, ObjectNode patch, JsonNode previous) {
        if (!"assumptions".equals(table) || !"employee.recommendation.v1".equals(key) || previous == null
                || !previous.isObject() || previous.has("preferenceWeights") || !object(previous.get("preferences"))) {
            return false;
        }
        JsonNode value = patch.get("value");
        if (value == null || value.isNull()) {
            return false;
        }
        if (!value.isObject()) {
            return false;
        }
        ObjectNode retained = ((ObjectNode) value).deepCopy();
        retained.remove("preferenceWeights");
        JsonNode weights = value.get("preferenceWeights");
        if (!PolicyDigest.of(retained).equals(PolicyDigest.of(previous)) || !object(weights)) {
            return false;
        }
        JsonNode preferences = previous.get("preferences");
        if (weights.size() != preferences.size()) {
            return false;
        }
        Iterator<String> names = preferences.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            JsonNode weight = weights.get(name);
            if (weight == null || !safeInteger(weight) || weight.doubleValue() < 0) {
                return false;
            }
        }
        return true;
    }
}
