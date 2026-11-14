package gcsp.api.brief;

import static gcsp.api.brief.Json.integer;
import static gcsp.api.brief.Json.only;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.BriefAccountPort.AccountFacts;
import gcsp.api.brief.BriefAccountPort.CurrentContract;
import gcsp.api.brief.BriefResult.Refusal;
import java.util.List;
import java.util.Optional;

/** The Account editor's pure views and sparse category patch over editable brief content and the policy rules. */
final class AccountEditor {

    static final String POLICY_KEY = BriefAssumptions.ACCOUNT_PREFERENCES;
    private static final List<String> LEVELS = List.of("medium", "high");

    private AccountEditor() {}

    private static Refusal refusal(String field, String reason) {
        return Refusal.invalid("invalid-preferences", field, reason);
    }

    private static CurrentContract car(Optional<AccountFacts> facts) {
        return facts.map(AccountFacts::currentContract).orElse(null);
    }

    private static boolean named(String s) {
        return s != null && !s.isBlank();
    }

    /** The policy's category definitions exactly as the page may draw them. */
    static ObjectNode projection(PolicyRules rules) {
        PolicyRules.AccountRules a = rules.account;
        ObjectNode p = Json.obj();
        p.put("schemaVersion", 1).put("policyVersion", rules.policyVersion);
        ArrayNode order = p.putArray("order");
        a.order().forEach(order::add);
        p.put("minimumCategories", a.minimumCategories());
        p.putObject("importance").put("medium", a.medium()).put("high", a.high());
        ObjectNode categories = p.putObject("categories");
        a.order().forEach(key -> categories.set(key, a.categories().get(key).deepCopy()));
        ObjectNode u = ((ObjectNode) a.understanding().deepCopy());
        u.put("policyKey", POLICY_KEY);
        p.set("understanding", u);
        return p;
    }

    /** The editor context: control definitions, slider, policy projection and the read-only known facts. */
    static ObjectNode context(PolicyRules rules, Optional<AccountFacts> facts, java.time.Instant observedAt) {
        ObjectNode preferences = Json.obj();
        rules.config.get("preferences").properties().forEach(e -> {
            JsonNode d = e.getValue();
            ObjectNode o = preferences.putObject(e.getKey());
            o.put("type", d.path("type").asText());
            if (d.has("values")) o.set("values", d.get("values").deepCopy());
            if (d.path("multiple").asBoolean(false)) o.put("multiple", true);
            o.set("label", rules.editor.get("preferences").get(e.getKey()).get("label").deepCopy());
            o.put("editable", true);
        });
        ObjectNode essentials = Json.obj();
        rules.config.get("essentials").properties().forEach(e -> essentials.set(e.getKey(), essential(e.getKey(), e.getValue())));
        essentials.set("charging", essential("charging", rules.charging()));
        ObjectNode knownFacts = Json.obj();
        ObjectNode permissions = Json.obj();
        String version = facts.map(AccountFacts::factsVersion).orElse(null);
        CurrentContract car = car(facts);
        ObjectNode fact = knownFacts.putObject("currentContract");
        if (car == null) {
            fact.putNull("value");
        } else {
            fact.putObject("value").put("contractId", car.contractId()).put("model", car.model());
        }
        fact.put("source", "manual-account");
        if (version == null) fact.putNull("sourceVersion");
        else fact.put("sourceVersion", version);
        fact.put("observedAt", observedAt.toString()).put("editable", false);
        if (car == null) fact.put("status", "missing");
        permissions.putObject("currentContract").put("editable", false);
        ObjectNode c = Json.obj();
        c.set("preferences", preferences);
        c.set("essentials", essentials);
        c.putObject("slider").put("minimum", rules.minimum).put("maximum", rules.maximum);
        c.set("knownFacts", knownFacts);
        c.set("permissions", permissions);
        c.put("policyVersion", rules.policyVersion);
        c.set("practicalQuestions", rules.editor.get("practicalQuestions").deepCopy());
        c.set("unconfirmedLabel", rules.editor.get("unconfirmedLabel").deepCopy());
        ArrayNode assumptions = c.putArray("assumptions");
        rules.assumptions.forEach(a -> assumptions.add(a.deepCopy()));
        c.set("accountPreferences", projection(rules));
        return c;
    }

    private static ObjectNode essential(String key, JsonNode d) {
        ObjectNode o = Json.obj();
        o.put("type", d.path("type").asText());
        o.set("operator", d.get("operator").deepCopy());
        o.set("unit", d.get("unit").deepCopy());
        if (d.has("values")) o.set("values", d.get("values").deepCopy());
        if ("number".equals(d.path("type").asText())) {
            o.put("minimum", 0);
            if ("seats".equals(key)) o.put("integer", true);
        }
        o.put("editable", true);
        return o;
    }

    /** The saved rating as the page sees it: only a rating for the current car counts; null without a current car. */
    static JsonNode rating(JsonNode content, Optional<AccountFacts> facts) {
        CurrentContract car = car(facts);
        if (car == null || !named(car.contractId())) return Json.M.nullNode();
        JsonNode stored = content.get("currentCarRating");
        ObjectNode v = Json.obj();
        boolean mine = stored != null && car.contractId().equals(stored.path("contractId").asText(null));
        v.set("value", mine ? stored.get("value") : Json.M.nullNode());
        v.put("contractId", car.contractId());
        return v;
    }

    /** Same again for the current car: on only when the stored intent names this contract. */
    static ObjectNode sameAgain(JsonNode content, Optional<AccountFacts> facts) {
        CurrentContract car = car(facts);
        ObjectNode v = Json.obj();
        if (car == null || !named(car.contractId())) {
            v.put("available", false).put("on", false).putNull("contractId").put("reason", "no-current-car");
        } else if (!named(car.model())) {
            v.put("available", false).put("on", false).putNull("contractId").put("reason", "current-car-unidentified");
        } else {
            v.put("available", true).put("on", BriefContent.sameAgainOn(content, car.contractId())).put("contractId", car.contractId());
        }
        return v;
    }

    private static int nearestStop(JsonNode stops, int value) {
        long middle = stops.get(stops.size() / 2).get("value").longValue();
        int best = 0;
        long bestDistance = Long.MAX_VALUE;
        long bestMiddle = Long.MAX_VALUE;
        for (JsonNode s : stops) {
            int stop = s.get("value").intValue();
            long d = Math.abs((long) stop - value);
            long m = Math.abs(stop - middle);
            if (d < bestDistance || (d == bestDistance && m < bestMiddle)) {
                best = stop;
                bestDistance = d;
                bestMiddle = m;
            }
        }
        return best;
    }

    /** What the employee has chosen per category, how many count, and the policy's understanding value. */
    static ObjectNode state(JsonNode content, PolicyRules rules, Optional<AccountFacts> facts) {
        PolicyRules.AccountRules a = rules.account;
        ObjectNode categories = Json.obj();
        int count = 0;
        for (String key : a.order()) {
            JsonNode p = content.path("preferences").get(key);
            ObjectNode out = categories.putObject(key);
            if (!Engagement.isConsidered(p, rules)) {
                out.put("state", "unset");
                continue;
            }
            count++;
            JsonNode def = a.categories().get(key);
            String importance = p.get("importance").intValue() >= a.highFrom() ? "high" : "medium";
            out.put("state", "considered");
            if ("multi".equals(def.get("kind").asText())) {
                ArrayNode list = out.putArray("value");
                if (p.get("value").isArray()) p.get("value").forEach(list::add);
                else list.add(p.get("value"));
                out.put("importance", importance).put("exact", true);
            } else {
                int value = p.get("value").intValue();
                boolean exact = false;
                for (JsonNode s : def.get("stops")) exact |= s.get("value").intValue() == value;
                out.put("value", exact ? value : nearestStop(def.get("stops"), value));
                out.put("importance", importance).put("exact", exact);
            }
        }
        boolean on = sameAgain(content, facts).path("on").booleanValue();
        JsonNode u = a.understanding();
        ObjectNode state = Json.obj();
        state.put("considered", count);
        state.set("categories", categories);
        state.put("sameAgain", on);
        ObjectNode understanding = state.putObject("understanding");
        understanding.put("kind", u.get("kind").asText());
        understanding.put("value", on ? u.get("sameAgain").intValue() : u.get("byConsidered").get(count).intValue());
        understanding.put("maximum", u.get("maximum").intValue()).put("basis", on ? "same-again" : "categories");
        understanding.put("considered", count).put("policyKey", POLICY_KEY).put("policyVersion", rules.policyVersion);
        return state;
    }

    private static boolean validValue(JsonNode def, JsonNode value) {
        if ("multi".equals(def.get("kind").asText())) {
            if (value == null || !value.isArray() || value.isEmpty()) return false;
            int last = -1;
            for (JsonNode v : value) {
                int at = -1;
                for (int i = 0; i < def.get("options").size(); i++) if (def.get("options").get(i).get("value").equals(v)) at = i;
                if (at <= last) return false;
                last = at;
            }
            return true;
        }
        if (!integer(value)) return false;
        for (JsonNode s : def.get("stops")) if (s.get("value").longValue() == value.longValue()) return true;
        return false;
    }

    /** Validates the sparse patch against the policy projection; null when acceptable. */
    static Refusal checkChanges(JsonNode changes, PolicyRules rules, boolean emptyOk) {
        if (changes == null || !changes.isObject() || (changes.isEmpty() && !emptyOk)) {
            return refusal("changes", "Change at least one category.");
        }
        for (var e : changes.properties()) {
            String key = e.getKey();
            JsonNode def = rules.account.categories().get(key);
            JsonNode change = e.getValue();
            if (def == null) return refusal("changes." + key, "Use one of the registered categories.");
            if (change.isNull()) continue;
            if (!only(change, "value", "importance") || change.isEmpty()) {
                return refusal("changes." + key, "Supply a value, an importance, or null to remove it.");
            }
            if (change.has("importance") && !(change.get("importance").isTextual() && LEVELS.contains(change.get("importance").asText()))) {
                return refusal("changes." + key + ".importance", "Use medium or high.");
            }
            if (change.has("value") && !validValue(def, change.get("value"))) {
                return refusal("changes." + key + ".value", "multi".equals(def.get("kind").asText())
                        ? "Choose at least one registered option, listed once and in the registered order." : "Use one of the registered stops.");
            }
        }
        return null;
    }

    /** Applies a checked patch to editable content in place; a refusal when importance has no preference to attach to. */
    static Refusal applyChanges(ObjectNode content, JsonNode changes, PolicyRules rules) {
        ObjectNode preferences = (ObjectNode) content.get("preferences");
        for (var e : changes.properties()) {
            String key = e.getKey();
            JsonNode change = e.getValue();
            JsonNode found = preferences.get(key);
            ObjectNode existing = found != null && Engagement.isConsidered(found, rules) ? (ObjectNode) found : null;
            if (change.isNull()) {
                preferences.remove(key);
                continue;
            }
            int importance = change.has("importance")
                    ? ("high".equals(change.get("importance").asText()) ? rules.account.high() : rules.account.medium())
                    : existing != null ? existing.get("importance").intValue() : rules.account.medium();
            if (change.has("value")) {
                ObjectNode p = Json.obj();
                p.set("value", "multi".equals(rules.account.categories().get(key).get("kind").asText())
                        ? change.get("value").deepCopy() : Json.M.getNodeFactory().numberNode(change.get("value").intValue()));
                p.put("importance", importance).put("valueState", "draft").put("importanceState", "draft").put("source", "employee");
                preferences.set(key, p);
            } else if (existing == null) {
                return refusal("changes." + key + ".importance", "Choose a preference before setting its importance.");
            } else {
                ObjectNode p = existing.deepCopy();
                p.put("importance", importance).put("importanceState", "draft").put("source", "employee");
                preferences.set(key, p);
            }
        }
        return null;
    }
}
