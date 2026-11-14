package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.Predicate;

/** Port of server/gcsp/predict/records/schema.js: the closed learning-record envelope and the brief-intent projection. */
public final class LearningRecords {

    public static final int LEARNING_RECORD_VERSION = 1;
    public static final String SYNTHETIC_DECLINE_TYPE = "just-not-this-one";
    public static final String INVALID_CODE = "invalid-learning-record";

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final List<String> PREFERENCE_KEYS = List.of("body", "fuel", "sportiness", "comfort", "economy", "size");
    private static final List<String> ESSENTIAL_KEYS = List.of("seats", "boot", "equipment", "body", "fuel", "frontIsofix", "rearIsofix", "modelLine", "charging");
    private static final List<String> STATES = List.of("draft", "inferred", "confirmed");
    private static final List<String> BODIES = List.of("hatchback", "saloon", "estate", "suv", "coupe", "convertible", "mpv");
    private static final List<String> FUELS = List.of("petrol", "diesel", "phev", "ev");
    private static final List<String> UNKNOWN_REASONS = List.of("not-captured", "missing-quote", "missing-context", "not-applicable");

    private LearningRecords() {}

    /** Node result('invalid') or ok(structuredClone(record)); reasons holds {field, reason} objects in check order. */
    public record Validation(String status, JsonNode value, String code, ArrayNode reasons) {
        public boolean isOk() {
            return "ok".equals(status);
        }
    }

    /** Node unknown(reason). */
    public static ObjectNode unknown(String reason) {
        ObjectNode node = JSON.objectNode();
        node.put("status", "unknown");
        node.put("reason", reason);
        return node;
    }

    // ---- primitives ----

    private static boolean exact(JsonNode v, String... keys) {
        if (!Js.isObject(v) || v.size() != keys.length) return false;
        for (String key : keys) if (!v.has(key)) return false;
        return true;
    }

    private static boolean text(JsonNode v) {
        return Js.isText(v) && v.textValue().length() > 0 && v.textValue().length() <= 512;
    }

    private static boolean configurationId(JsonNode v) {
        return Js.isText(v) && v.textValue().length() > 0 && v.textValue().length() <= 2048;
    }

    private static boolean positive(JsonNode v) {
        return Js.safeInteger(v) && v.doubleValue() > 0;
    }

    private static boolean nonnegative(JsonNode v) {
        return Js.finite(v) && v.doubleValue() >= 0;
    }

    private static boolean integer(JsonNode v) {
        return Js.finite(v) && v.doubleValue() == Math.rint(v.doubleValue());
    }

    private static boolean slider(JsonNode v) {
        return integer(v) && v.doubleValue() >= 0 && v.doubleValue() <= 100;
    }

    private static boolean isNull(JsonNode v) {
        return v != null && v.isNull();
    }

    private static boolean nullOrText(JsonNode v) {
        return isNull(v) || text(v);
    }

    private static boolean validInstant(JsonNode v) {
        return Js.isText(v) && Instants.valid(v.textValue());
    }

    private static boolean instant(JsonNode v) {
        return isNull(v) || validInstant(v);
    }

    private static boolean category(JsonNode v) {
        return Js.isText(v) && v.textValue().matches("[A-Za-z0-9][A-Za-z0-9 .+/_=-]{0,127}");
    }

    private static boolean isString(JsonNode v, List<String> values) {
        return Js.isText(v) && values.contains(v.textValue());
    }

    private static boolean bool(JsonNode v) {
        return v != null && v.isBoolean();
    }

    /** A legacy scalar or a non-empty list of unique registered values. */
    private static boolean choice(JsonNode v, List<String> values) {
        if (v != null && v.isArray()) {
            if (v.size() == 0) return false;
            Set<String> seen = new HashSet<>();
            for (JsonNode item : v) if (!Js.isText(item) || !seen.add(item.textValue())) return false;
            for (JsonNode item : v) if (!values.contains(item.textValue())) return false;
            return true;
        }
        return isString(v, values);
    }

    private static boolean known(JsonNode v, Predicate<JsonNode> check) {
        return exact(v, "status", "value") && Js.isString(v.get("status"), "known") && check.test(v.get("value"));
    }

    private static boolean unknownValue(JsonNode v) {
        return exact(v, "status", "reason") && Js.isString(v.get("status"), "unknown") && isString(v.get("reason"), UNKNOWN_REASONS);
    }

    private static boolean evidence(JsonNode v, Predicate<JsonNode> check) {
        return unknownValue(v) || known(v, check);
    }

    private static boolean preferences(JsonNode v) {
        if (!Js.isObject(v)) return false;
        for (Iterator<Map.Entry<String, JsonNode>> it = v.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            String key = entry.getKey();
            JsonNode p = entry.getValue();
            if (!PREFERENCE_KEYS.contains(key) || !exact(p, "value", "importance", "valueState", "importanceState") || !slider(p.get("importance"))
                    || !isString(p.get("valueState"), STATES) || !isString(p.get("importanceState"), STATES)) return false;
            boolean value = key.equals("body") ? choice(p.get("value"), BODIES) : key.equals("fuel") ? choice(p.get("value"), FUELS) : slider(p.get("value"));
            if (!value) return false;
        }
        return true;
    }

    private static boolean essentials(JsonNode v) {
        if (!Js.isObject(v)) return false;
        for (Iterator<Map.Entry<String, JsonNode>> it = v.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            String key = entry.getKey();
            JsonNode e = entry.getValue();
            if (!ESSENTIAL_KEYS.contains(key) || !exact(e, "value", "operator", "unit", "state")
                    || !(isString(e.get("state"), STATES) || Js.isString(e.get("state"), "needs-confirmation"))) return false;
            boolean sized = key.equals("seats") || key.equals("boot");
            String operator = sized ? "gte" : key.equals("equipment") ? "includes" : "equals";
            String unit = key.equals("seats") ? "count" : key.equals("boot") ? "L" : key.equals("equipment") ? "equipment-key" : null;
            if (!Js.isString(e.get("operator"), operator)) return false;
            if (unit == null ? !isNull(e.get("unit")) : !Js.isString(e.get("unit"), unit)) return false;
            JsonNode value = e.get("value");
            boolean valid;
            if (isNull(value)) valid = Js.isString(e.get("state"), "needs-confirmation");
            else if (sized) valid = nonnegative(value);
            else if (key.equals("equipment")) valid = value.isArray() && allMatch(value, LearningRecords::category);
            else if (key.equals("frontIsofix") || key.equals("rearIsofix")) valid = bool(value);
            else if (key.equals("body")) valid = isString(value, BODIES);
            else if (key.equals("fuel")) valid = isString(value, FUELS);
            else if (key.equals("charging")) valid = isString(value, List.of("home", "work", "either", "not-ready"));
            else valid = category(value);
            if (!valid) return false;
        }
        return true;
    }

    private static boolean allMatch(JsonNode array, Predicate<JsonNode> check) {
        for (JsonNode item : array) if (!check.test(item)) return false;
        return true;
    }

    private static boolean exposure(JsonNode v) {
        return evidence(v, x -> exact(x, "from", "until", "seconds") && validInstant(x.get("from")) && validInstant(x.get("until"))
                && Instants.parse(x.get("until").textValue()) >= Instants.parse(x.get("from").textValue()) && nonnegative(x.get("seconds"))
                && x.get("seconds").doubleValue()
                        == (double) (Instants.parse(x.get("until").textValue()) - Instants.parse(x.get("from").textValue())) / 1000);
    }

    private static boolean terms(JsonNode v) {
        return evidence(v, x -> exact(x, "quoteRef", "configurationId", "monthlyPoints", "allowance", "unit", "quotedAt", "validUntil", "policyVersion")
                && text(x.get("quoteRef")) && configurationId(x.get("configurationId")) && nonnegative(x.get("monthlyPoints"))
                && nonnegative(x.get("allowance")) && Js.isString(x.get("unit"), "points/month") && validInstant(x.get("quotedAt"))
                && validInstant(x.get("validUntil"))
                && Instants.parse(x.get("validUntil").textValue()) >= Instants.parse(x.get("quotedAt").textValue()) && text(x.get("policyVersion")));
    }

    private static boolean event(JsonNode v, List<String> allowed) {
        return exact(v, "state", "at") && isString(v.get("state"), allowed) && instant(v.get("at"))
                && (!Js.isString(v.get("state"), "unknown") || isNull(v.get("at")));
    }

    private static boolean validDeclineReason(JsonNode reasonType, JsonNode provenance, List<String> codes) {
        JsonNode kind = Js.get(provenance, "kind");
        return Js.isString(reasonType, "unclassified")
                || Js.isString(kind, "synthetic") && Js.isString(reasonType, SYNTHETIC_DECLINE_TYPE)
                || Js.isString(kind, "observed") && codes != null && Js.isText(reasonType) && codes.contains(reasonType.textValue());
    }

    private static boolean has(JsonNode outcomes, String key, String state) {
        return Js.isString(Js.get(Js.get(outcomes, key), "state"), state);
    }

    private static boolean outcomesShape(JsonNode o, JsonNode provenance, List<String> codes) {
        if (!exact(o, "offered", "selection", "acceptance", "decline", "expiry", "wait", "satisfaction")) return false;
        if (!event(o.get("offered"), List.of("offered", "unknown")) || !event(o.get("selection"), List.of("selected", "pending", "unknown"))
                || !event(o.get("acceptance"), List.of("accepted", "pending", "unknown")) || !event(o.get("expiry"), List.of("expired", "unknown"))) return false;
        JsonNode decline = o.get("decline");
        if (!exact(decline, "state", "at", "reasonType")) return false;
        ObjectNode declineEvent = JSON.objectNode();
        declineEvent.set("state", decline.get("state"));
        declineEvent.set("at", decline.get("at"));
        if (!event(declineEvent, List.of("declined", "unknown"))) return false;
        if (!(Js.isString(decline.get("state"), "declined") ? validDeclineReason(decline.get("reasonType"), provenance, codes)
                : isNull(decline.get("reasonType")))) return false;
        JsonNode wait = o.get("wait");
        if (!exact(wait, "state", "at", "reasonType")) return false;
        ObjectNode waitEvent = JSON.objectNode();
        waitEvent.set("state", wait.get("state"));
        waitEvent.set("at", wait.get("at"));
        if (!event(waitEvent, List.of("waited", "unknown"))) return false;
        if (!(Js.isString(wait.get("state"), "waited") ? Js.isString(wait.get("reasonType"), "no-acceptable-choice") : isNull(wait.get("reasonType")))) return false;
        return event(o.get("satisfaction"), List.of("satisfied", "dissatisfied", "unknown"));
    }

    /**
     * Node validateLearningRecord. A projectedAt that is not a validInstant string is NaN here, where Node would Date.parse
     * it; only the timestamps.business reason can differ for such a malformed record.
     */
    public static Validation validate(JsonNode r, List<String> declineReasonCodes) {
        ArrayNode errors = JSON.arrayNode();
        BiConsumer<String, Boolean> check = (field, valid) -> {
            if (!valid) {
                ObjectNode error = errors.addObject();
                error.put("field", field);
                error.put("reason", "Invalid learning-record field.");
            }
        };
        boolean envelope = exact(r, "schemaVersion", "recordId", "runId", "subject", "target", "renewal", "entitlement", "brief", "choiceSet",
                "terms", "outcomes", "timestamps", "provenance");
        check.accept("record", envelope);
        if (!Js.isObject(r)) return new Validation("invalid", null, INVALID_CODE, errors);
        JsonNode schemaVersion = r.get("schemaVersion");
        check.accept("schemaVersion", Js.isNumberEqual(schemaVersion, LEARNING_RECORD_VERSION));
        JsonNode subject = r.get("subject");
        check.accept("identity", text(r.get("recordId")) && text(r.get("runId")) && exact(subject, "employeeRef", "entitlementSlotRef", "renewalRef")
                && text(subject.get("employeeRef")) && nullOrText(subject.get("entitlementSlotRef")) && nullOrText(subject.get("renewalRef")));
        JsonNode target = r.get("target");
        check.accept("target", exact(target, "offerRef", "holdRef", "quoteRef", "orderRef", "configurationId")
                && nullOrText(target.get("offerRef")) && nullOrText(target.get("holdRef")) && nullOrText(target.get("quoteRef"))
                && nullOrText(target.get("orderRef")) && evidence(target.get("configurationId"), LearningRecords::configurationId));
        JsonNode renewal = r.get("renewal");
        check.accept("renewal", exact(renewal, "cohort", "period") && evidence(renewal.get("cohort"), LearningRecords::text)
                && evidence(renewal.get("period"), v -> exact(v, "from", "until") && validInstant(v.get("from")) && validInstant(v.get("until"))
                        && Instants.parse(v.get("until").textValue()) >= Instants.parse(v.get("from").textValue())));
        JsonNode entitlement = r.get("entitlement");
        boolean entitlementOk = exact(entitlement, "schemeId", "gradeId", "allowanceBand");
        if (entitlementOk) for (JsonNode v : entitlement) entitlementOk = entitlementOk && evidence(v, LearningRecords::category);
        check.accept("entitlement", entitlementOk);
        JsonNode brief = r.get("brief");
        check.accept("brief", exact(brief, "briefVersion", "policyVersion", "confirmedAt", "preferences", "essentials")
                && positive(brief.get("briefVersion")) && text(brief.get("policyVersion")) && validInstant(brief.get("confirmedAt"))
                && preferences(brief.get("preferences")) && essentials(brief.get("essentials")));
        check.accept("choiceSet", evidence(r.get("choiceSet"), v -> v.isArray() && allMatch(v, a ->
                (exact(a, "configurationId", "exposure", "eligible", "available", "terms") || exact(a, "configurationId", "orderRef", "eligible", "available", "exposure", "terms") && text(a.get("orderRef")))
                        && configurationId(a.get("configurationId")) && (isNull(a.get("eligible")) || bool(a.get("eligible")))
                        && (isNull(a.get("available")) || bool(a.get("available"))) && exposure(a.get("exposure")) && terms(a.get("terms")))));
        check.accept("terms", terms(r.get("terms")));
        JsonNode o = r.get("outcomes");
        check.accept("outcomes", outcomesShape(o, r.get("provenance"), declineReasonCodes));
        if (Js.isObject(o)) {
            List<String> five = List.of("offered", "selection", "acceptance", "decline", "expiry");
            boolean allUnknown = true;
            for (String key : five) allUnknown = allUnknown && has(o, key, "unknown");
            check.accept("outcomes.wait", !has(o, "wait", "waited") || allUnknown);
            boolean declinedWithOutcome = has(o, "decline", "declined") && (has(o, "acceptance", "accepted") || has(o, "selection", "selected") || has(o, "expiry", "expired"));
            boolean expiredWithOutcome = has(o, "expiry", "expired") && (has(o, "acceptance", "accepted") || has(o, "selection", "selected"));
            boolean pendingWithOutcome = (has(o, "selection", "pending") || has(o, "acceptance", "pending"))
                    && (has(o, "acceptance", "accepted") || has(o, "selection", "selected") || has(o, "decline", "declined") || has(o, "expiry", "expired"));
            check.accept("outcomes.consistency", !declinedWithOutcome && !expiredWithOutcome && !pendingWithOutcome);
        }
        JsonNode timestamps = r.get("timestamps");
        check.accept("timestamps", exact(timestamps, "projectedAt", "clockVersion") && validInstant(timestamps.get("projectedAt"))
                && (text(timestamps.get("clockVersion")) || positive(timestamps.get("clockVersion"))));
        JsonNode projectedAt = Js.get(timestamps, "projectedAt");
        double asOf = validInstant(projectedAt) ? Instants.parse(projectedAt.textValue()) : Double.NaN;
        Predicate<JsonNode> captured = at -> validInstant(at) && Instants.parse(at.textValue()) <= asOf;
        boolean business = captured.test(Js.get(brief, "confirmedAt"));
        if (business && Js.isObject(o)) for (JsonNode value : o) {
            JsonNode at = Js.get(value, "at");
            business = business && (at == null || at.isNull() || captured.test(at));
        }
        JsonNode termsNode = r.get("terms");
        if (business && Js.isString(Js.get(termsNode, "status"), "known")) business = captured.test(Js.get(Js.get(termsNode, "value"), "quotedAt"));
        JsonNode choiceSet = r.get("choiceSet");
        if (business && Js.isString(Js.get(choiceSet, "status"), "known") && choiceSet.get("value") != null && choiceSet.get("value").isArray()) {
            for (JsonNode alternative : choiceSet.get("value")) {
                JsonNode alternativeTerms = Js.get(alternative, "terms");
                if (Js.isString(Js.get(alternativeTerms, "status"), "known")) business = business && captured.test(Js.get(Js.get(alternativeTerms, "value"), "quotedAt"));
            }
        }
        check.accept("timestamps.business", business);
        JsonNode provenance = r.get("provenance");
        boolean synthetic = Js.isString(Js.get(provenance, "kind"), "synthetic");
        boolean provenanceOk = (synthetic ? exact(provenance, "kind", "generatorVersion", "seed") : exact(provenance, "kind"))
                && (Js.isString(provenance.get("kind"), "observed")
                        || synthetic && text(provenance.get("generatorVersion")) && (text(provenance.get("seed")) || Js.safeInteger(provenance.get("seed"))));
        check.accept("provenance", provenanceOk);
        if (errors.size() > 0) return new Validation("invalid", null, INVALID_CODE, errors);
        return new Validation("ok", r.deepCopy(), null, errors);
    }

    /** Node projectBriefIntent: only the allowlisted preference and essential fields survive. */
    public static ObjectNode projectBriefIntent(JsonNode brief) {
        ObjectNode out = JSON.objectNode();
        ObjectNode preferences = out.putObject("preferences");
        JsonNode source = Js.get(brief, "preferences");
        if (Js.isObject(source)) for (Iterator<Map.Entry<String, JsonNode>> it = source.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            if (PREFERENCE_KEYS.contains(entry.getKey())) preferences.set(entry.getKey(), pick(entry.getValue(), "value", "importance", "valueState", "importanceState"));
        }
        ObjectNode essentials = out.putObject("essentials");
        source = Js.get(brief, "essentials");
        if (Js.isObject(source)) for (Iterator<Map.Entry<String, JsonNode>> it = source.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            if (ESSENTIAL_KEYS.contains(entry.getKey())) essentials.set(entry.getKey(), pick(entry.getValue(), "value", "operator", "unit", "state"));
        }
        return out;
    }

    /** Copies the named fields; a missing one is left out, as an undefined property is in Node JSON. */
    private static ObjectNode pick(JsonNode source, String... keys) {
        ObjectNode out = JSON.objectNode();
        for (String key : keys) {
            JsonNode value = Js.get(source, key);
            if (value != null) out.set(key, value.deepCopy());
        }
        return out;
    }
}
