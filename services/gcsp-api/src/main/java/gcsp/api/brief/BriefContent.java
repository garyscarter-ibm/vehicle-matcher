package gcsp.api.brief;

import static gcsp.api.brief.Json.flag;
import static gcsp.api.brief.Json.instant;
import static gcsp.api.brief.Json.integer;
import static gcsp.api.brief.Json.object;
import static gcsp.api.brief.Json.only;
import static gcsp.api.brief.Json.same;
import static gcsp.api.brief.Json.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** Editable brief content: validation, policy defaults, the semantic digest and confirmed-content rules. */
final class BriefContent {

    static final String POLICY_SOURCE = "policy:brief.editor.v1";
    private static final List<String> STATES = List.of("draft", "inferred", "confirmed");
    private static final String BAD_FIELD = "Unsupported or invalid brief field.";

    private BriefContent() {}

    /** An untouched policy default preference: neither value nor importance was ever set by the employee. */
    static boolean unselectedPreference(JsonNode p) {
        return p != null && POLICY_SOURCE.equals(p.path("source").asText(null))
                && "draft".equals(p.path("valueState").asText(null)) && "draft".equals(p.path("importanceState").asText(null));
    }

    /** An unanswered optional practical question from the editor defaults. */
    static boolean unselectedPracticalAnswer(JsonNode e) {
        return e != null && POLICY_SOURCE.equals(e.path("source").asText(null))
                && "needs-confirmation".equals(e.path("state").asText(null)) && e.path("value").isNull();
    }

    /** Null when the brief is acceptable; confirming also refuses inferred suggestions. */
    static BriefResult.Refusal validate(JsonNode brief, PolicyRules rules, boolean confirming) {
        if (!only(brief, "schemaVersion", "preferences", "essentials", "currentCarFeedback", "currentCarRating", "sameAgain")
                || !integer(brief.get("schemaVersion")) || brief.get("schemaVersion").intValue() != 1
                || !object(brief.get("preferences")) || !object(brief.get("essentials"))) {
            return BriefResult.Refusal.invalid("invalid-brief", "brief", "Supply schemaVersion, preferences and essentials.");
        }
        ArrayNode errors = Json.arr();
        brief.get("preferences").properties().forEach(e -> {
            if (!validPreference(e.getKey(), e.getValue(), rules)) errors.addObject().put("field", "preferences." + e.getKey()).put("reason", BAD_FIELD);
        });
        brief.get("essentials").properties().forEach(e -> {
            if (!validEssential(e.getKey(), e.getValue(), rules)) errors.addObject().put("field", "essentials." + e.getKey())
                    .put("reason", "Use a registered essential; unresolved values stay null and need confirmation.");
        });
        if (!errors.isEmpty()) {
            ObjectNode extra = Json.obj();
            extra.set("reasons", errors);
            return BriefResult.Refusal.invalid("invalid-brief", "The brief has invalid fields.", extra);
        }
        JsonNode feedback = brief.get("currentCarFeedback");
        if (feedback != null && !validFeedback(feedback, rules)) {
            return BriefResult.Refusal.invalid("invalid-brief", "currentCarFeedback",
                    "Supply separate preserve/change preference keys and a source.");
        }
        if (brief.has("currentCarRating") && !validRating(brief.get("currentCarRating"))) {
            return BriefResult.Refusal.invalid("invalid-brief", "currentCarRating",
                    "Supply a 1 to 5 rating or null, the current contract, the employee source and the rating time.");
        }
        if (brief.has("sameAgain") && !validSameAgain(brief.get("sameAgain"))) {
            return BriefResult.Refusal.invalid("invalid-brief", "sameAgain",
                    "Supply a boolean on, the current contract, the employee source and the time.");
        }
        if (confirming && inferred(brief)) {
            return BriefResult.Refusal.invalid("confirmation-required", "brief",
                    "Review inferred suggestions in a new draft before confirming.");
        }
        return null;
    }

    private static boolean inferred(JsonNode brief) {
        for (JsonNode p : brief.get("preferences")) {
            if ("inferred".equals(p.path("valueState").asText()) || "inferred".equals(p.path("importanceState").asText())) return true;
        }
        for (JsonNode e : brief.get("essentials")) if ("inferred".equals(e.path("state").asText())) return true;
        return brief.has("currentCarFeedback") && "inferred".equals(brief.get("currentCarFeedback").path("state").asText());
    }

    private static boolean within(JsonNode v, PolicyRules rules) {
        return integer(v) && v.intValue() >= rules.minimum && v.intValue() <= rules.maximum;
    }

    private static boolean nonBlank(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank();
    }

    private static boolean validPreference(String key, JsonNode p, PolicyRules rules) {
        JsonNode d = rules.config.get("preferences").get(key);
        if (d == null || !only(p, "value", "importance", "valueState", "importanceState", "source", "confirmedAt")
                || !within(p.get("importance"), rules) || !STATES.contains(p.path("valueState").asText(null))
                || !STATES.contains(p.path("importanceState").asText(null)) || !nonBlank(p.get("source"))
                || (p.has("confirmedAt") && !instant(p.get("confirmedAt")))) return false;
        return "slider".equals(d.path("type").asText()) ? within(p.get("value"), rules) : validChoice(p.get("value"), d);
    }

    /** A multiple enum takes a scalar or unique registered values in registry order; others a registered scalar. */
    private static boolean validChoice(JsonNode value, JsonNode d) {
        if (value == null || !d.path("values").isArray()) return false;
        JsonNode values = d.get("values");
        if (d.path("multiple").asBoolean(false) && value.isArray()) {
            if (value.isEmpty()) return false;
            int last = -1;
            for (JsonNode v : value) {
                int at = Json.indexOf(values, v);
                if (at < 0 || at <= last) return false;
                last = at;
            }
            return true;
        }
        return Json.contains(values, value);
    }

    private static boolean validEssential(String key, JsonNode e, PolicyRules rules) {
        JsonNode d = "charging".equals(key) ? rules.charging() : rules.config.get("essentials").get(key);
        if (d == null || !only(e, "operator", "value", "unit", "state", "source", "confirmedAt")
                || !same(e.get("operator"), d.get("operator")) || !same(e.get("unit"), d.get("unit"))
                || !(STATES.contains(e.path("state").asText(null)) || "needs-confirmation".equals(e.path("state").asText(null)))
                || !nonBlank(e.get("source")) || (e.has("confirmedAt") && !instant(e.get("confirmedAt")))) return false;
        JsonNode v = e.get("value");
        if (v == null) return false;
        if (v.isNull()) return "needs-confirmation".equals(e.path("state").asText());
        return switch (d.path("type").asText("")) {
            case "number" -> v.isNumber() && Double.isFinite(v.doubleValue()) && v.doubleValue() >= 0
                    && (!"seats".equals(key) || integer(v));
            case "enum" -> Json.contains(d.path("values"), v);
            case "boolean" -> v.isBoolean();
            case "string" -> nonBlank(v);
            case "list" -> {
                if (!v.isArray()) yield false;
                for (JsonNode i : v) if (!nonBlank(i)) yield false;
                yield true;
            }
            default -> false;
        };
    }

    private static boolean validFeedback(JsonNode f, PolicyRules rules) {
        if (!only(f, "preserve", "change", "state", "source") || !text(f.get("source"))
                || !STATES.contains(f.path("state").asText(null))) return false;
        for (String k : List.of("preserve", "change")) {
            JsonNode list = f.get(k);
            if (list == null || !list.isArray()) return false;
            for (JsonNode v : list) if (!text(v) || !rules.config.get("preferences").has(v.asText())) return false;
        }
        return true;
    }

    static boolean validRating(JsonNode r) {
        if (!only(r, "value", "contractId", "source", "ratedAt")) return false;
        for (String k : List.of("value", "contractId", "source", "ratedAt")) if (!r.has(k)) return false;
        JsonNode v = r.get("value");
        return (v.isNull() || integer(v) && v.intValue() >= 1 && v.intValue() <= 5) && text(r.get("contractId"))
                && "employee".equals(r.get("source").asText(null)) && instant(r.get("ratedAt"));
    }

    static boolean validSameAgain(JsonNode s) {
        if (!only(s, "on", "contractId", "source", "setAt")) return false;
        for (String k : List.of("on", "contractId", "source", "setAt")) if (!s.has(k)) return false;
        return s.get("on").isBoolean() && text(s.get("contractId")) && "employee".equals(s.get("source").asText(null))
                && instant(s.get("setAt"));
    }

    /** The policy's unconfirmed starting content: every registered preference at its default, practical answers unset. */
    static ObjectNode defaults(PolicyRules rules) {
        ObjectNode preferences = Json.obj();
        rules.config.get("preferences").fieldNames().forEachRemaining(key -> {
            JsonNode initial = rules.editor.get("preferences").get(key);
            if (!only(initial, "label", "value", "importance") || !text(initial.get("label")) || !initial.has("value")) {
                throw new PolicyRules.Unavailable("Missing editor preference " + key);
            }
            ObjectNode p = preferences.putObject(key);
            p.set("value", initial.get("value").deepCopy());
            p.set("importance", initial.get("importance").deepCopy());
            p.put("valueState", "draft").put("importanceState", "draft").put("source", POLICY_SOURCE);
        });
        ObjectNode essentials = Json.obj();
        rules.editor.get("practicalQuestions").properties().forEach(en -> {
            String key = en.getKey();
            JsonNode q = en.getValue();
            JsonNode d = "charging".equals(key) ? rules.charging() : rules.config.get("essentials").get(key);
            if (d == null || !only(q, "label", "yes", "no", "unknown") || !text(q.get("label")) || !q.path("unknown").isNull()
                    || !q.has("unknown")) throw new PolicyRules.Unavailable("Missing practical question " + key);
            for (String answer : List.of("yes", "no")) {
                JsonNode value = q.get(answer);
                if (value == null) throw new PolicyRules.Unavailable("Missing practical answer " + key);
                // Charging maps one answer to several registered values; other lists are validated whole.
                List<JsonNode> values = new ArrayList<>();
                if ("charging".equals(key) && value.isArray()) value.forEach(values::add);
                else values.add(value);
                for (JsonNode v : values) {
                    ObjectNode trial = Json.obj();
                    trial.set("operator", d.get("operator"));
                    trial.set("unit", d.get("unit"));
                    trial.set("value", v);
                    trial.put("state", "draft").put("source", "employee");
                    if (!validEssential(key, trial, rules)) throw new PolicyRules.Unavailable("Invalid question mapping " + key);
                }
            }
            ObjectNode e = essentials.putObject(key);
            e.set("operator", d.get("operator"));
            e.set("unit", d.get("unit"));
            e.putNull("value");
            e.put("state", "needs-confirmation").put("source", POLICY_SOURCE);
        });
        ObjectNode initial = Json.obj();
        initial.put("schemaVersion", 1);
        initial.set("preferences", preferences);
        initial.set("essentials", essentials);
        if (validate(initial, rules, false) != null) throw new PolicyRules.Unavailable("Invalid defaults");
        return initial;
    }

    /** The content a confirmed version stores: validated for confirmation, with chosen states set to confirmed. */
    static ObjectNode confirmed(JsonNode source, PolicyRules rules, String now) {
        BriefResult.Refusal refusal = validate(source, rules, true);
        if (refusal != null) throw new BriefResult.Refused(refusal);
        ObjectNode brief = source.deepCopy();
        brief.get("preferences").properties().forEach(en -> {
            if (!unselectedPreference(en.getValue())) {
                ObjectNode p = (ObjectNode) en.getValue();
                p.put("valueState", "confirmed").put("importanceState", "confirmed").put("confirmedAt", now);
            }
        });
        brief.get("essentials").properties().forEach(en -> {
            ObjectNode e = (ObjectNode) en.getValue();
            if (!"needs-confirmation".equals(e.path("state").asText())) e.put("state", "confirmed").put("confirmedAt", now);
        });
        if (brief.has("currentCarFeedback")) ((ObjectNode) brief.get("currentCarFeedback")).put("state", "confirmed");
        return brief;
    }

    /** Essentials that are still unanswered or unconfirmed, for the validation view. */
    static ArrayNode unknownEssentials(JsonNode content) {
        ArrayNode out = Json.arr();
        content.get("essentials").properties().forEach(en -> {
            JsonNode e = en.getValue();
            if (!unselectedPracticalAnswer(e) && (!"confirmed".equals(e.path("state").asText()) || e.path("value").isNull())) {
                out.add(en.getKey());
            }
        });
        return out;
    }

    /** Digest of what the employee means: values and importance, never states, sources or timestamps. */
    static String semanticDigest(JsonNode b) {
        ObjectNode s = Json.obj();
        ObjectNode prefs = s.putObject("preferences");
        b.get("preferences").properties().forEach(en -> {
            ObjectNode p = prefs.putObject(en.getKey());
            p.set("value", en.getValue().get("value"));
            p.set("importance", en.getValue().get("importance"));
        });
        ObjectNode ess = s.putObject("essentials");
        b.get("essentials").properties().forEach(en -> {
            JsonNode e = en.getValue();
            ObjectNode o = ess.putObject(en.getKey());
            JsonNode value = e.get("value");
            if ("includes".equals(e.path("operator").asText()) && value != null && value.isArray()) {
                TreeSet<String> sorted = new TreeSet<>();
                value.forEach(v -> sorted.add(v.asText()));
                ArrayNode a = o.putArray("value");
                sorted.forEach(a::add);
            } else if (value != null) {
                o.set("value", value);
            }
            if (e.has("operator")) o.set("operator", e.get("operator"));
            if (e.has("unit")) o.set("unit", e.get("unit"));
        });
        JsonNode f = b.get("currentCarFeedback");
        if (f == null) {
            s.putNull("feedback");
        } else {
            ObjectNode fo = s.putObject("feedback");
            fo.set("preserve", sortedStrings(f.get("preserve")));
            fo.set("change", sortedStrings(f.get("change")));
        }
        JsonNode rating = b.get("currentCarRating");
        if (rating != null && !rating.isNull()) {
            ObjectNode r = s.putObject("rating");
            r.set("value", rating.get("value"));
            r.set("contractId", rating.get("contractId"));
        }
        JsonNode again = b.get("sameAgain");
        if (again != null && !again.isNull()) {
            ObjectNode r = s.putObject("sameAgain");
            r.set("on", again.get("on"));
            r.set("contractId", again.get("contractId"));
        }
        return Canonical.digest(s);
    }

    private static ArrayNode sortedStrings(JsonNode list) {
        TreeSet<String> sorted = new TreeSet<>();
        list.forEach(v -> sorted.add(v.asText()));
        ArrayNode a = Json.arr();
        sorted.forEach(a::add);
        return a;
    }

    /** True when Same again is switched on for exactly this contract. */
    static boolean sameAgainOn(JsonNode content, String contractId) {
        JsonNode s = content.get("sameAgain");
        return contractId != null && s != null && contractId.equals(s.path("contractId").asText(null)) && flag(s, "on");
    }
}
