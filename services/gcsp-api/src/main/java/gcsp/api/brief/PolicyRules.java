package gcsp.api.brief;

import static gcsp.api.brief.Json.integer;
import static gcsp.api.brief.Json.object;
import static gcsp.api.brief.Json.only;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** The brief rules parsed from the pinned policy entries; anything missing or malformed is unavailable (fail closed). */
final class PolicyRules {

    /** A policy entry that is absent or malformed; the command answers unavailable and writes nothing. */
    static final class Unavailable extends RuntimeException {
        Unavailable(String message) {
            super(message, null, false, false);
        }
    }

    record Grants(boolean search, boolean hold) {}

    /** The Account category rules (brief.accountPreferences.v1). */
    record AccountRules(int medium, int high, int highFrom, int minimumCategories, List<String> order,
            Map<String, JsonNode> categories, JsonNode understanding) {}

    final String policyVersion;
    final JsonNode config;
    final int minimum;
    final int maximum;
    final JsonNode lifecycle;
    final JsonNode editor;
    final AccountRules account;
    final List<JsonNode> assumptions;
    private final BriefAssumptions source;

    private PolicyRules(String policyVersion, JsonNode config, int minimum, int maximum, JsonNode lifecycle,
            JsonNode editor, AccountRules account, List<JsonNode> assumptions, BriefAssumptions source) {
        this.policyVersion = policyVersion;
        this.config = config;
        this.minimum = minimum;
        this.maximum = maximum;
        this.lifecycle = lifecycle;
        this.editor = editor;
        this.account = account;
        this.assumptions = assumptions;
        this.source = source;
    }

    JsonNode charging() {
        return lifecycle.get("charging");
    }

    /** Empty when the policy is unavailable or any required entry is malformed. */
    static Optional<PolicyRules> load(BriefPolicyPort port, String policyVersion) {
        Optional<BriefAssumptions> found = port.assumptions(policyVersion);
        if (found.isEmpty() || !policyVersion.equals(found.get().policyVersion())) return Optional.empty();
        BriefAssumptions a = found.get();
        JsonNode config = a.payload(BriefAssumptions.RECOMMENDATION);
        JsonNode min = a.payload(BriefAssumptions.SLIDER_MINIMUM);
        JsonNode max = a.payload(BriefAssumptions.SLIDER_MAXIMUM);
        JsonNode lifecycle = a.payload(BriefAssumptions.LIFECYCLE);
        JsonNode editor = a.payload(BriefAssumptions.EDITOR);
        JsonNode editorEntry = a.entry(BriefAssumptions.EDITOR);
        if (!object(config) || !object(config.get("preferences")) || !object(config.get("essentials"))) return Optional.empty();
        if (!integer(min) || min.intValue() != 0 || !integer(max) || max.intValue() != 100) return Optional.empty();
        if (!object(lifecycle) || !object(lifecycle.get("charging")) || !lifecycle.get("charging").path("values").isArray()) {
            return Optional.empty();
        }
        if (!object(editor) || !object(editor.get("preferences")) || !object(editor.get("practicalQuestions"))
                || !Json.text(editor.get("unconfirmedLabel")) || !assumed(editorEntry)) return Optional.empty();
        Optional<AccountRules> account = account(a.entry(BriefAssumptions.ACCOUNT_PREFERENCES), config, 0, 100);
        if (account.isEmpty()) return Optional.empty();
        List<JsonNode> shown = new ArrayList<>();
        for (String key : List.of(BriefAssumptions.SLIDER_MINIMUM, BriefAssumptions.SLIDER_MAXIMUM, BriefAssumptions.LIFECYCLE,
                BriefAssumptions.EDITOR, BriefAssumptions.ACCOUNT_PREFERENCES)) shown.add(a.entry(key));
        return Optional.of(new PolicyRules(policyVersion, config, 0, 100, lifecycle, editor, account.get(), shown, a));
    }

    /** Grants and the minimum-loss action; unavailable when the entry is missing or malformed. */
    Grants engagement() {
        JsonNode entry = source.entry(BriefAssumptions.ENGAGEMENT);
        JsonNode v = entry == null ? null : entry.get("value");
        if (!assumed(entry) || !only(v, "schemaVersion", "grants", "onMinimumLoss") || !integer(v.get("schemaVersion"))
                || v.get("schemaVersion").intValue() != 1 || !"disengage".equals(v.path("onMinimumLoss").asText(null))
                || !only(v.get("grants"), "search", "hold") || !v.get("grants").path("search").isBoolean()
                || !v.get("grants").path("hold").isBoolean()) {
            throw new Unavailable("The engagement policy is missing or malformed");
        }
        return new Grants(v.get("grants").get("search").booleanValue(), v.get("grants").get("hold").booleanValue());
    }

    private static boolean assumed(JsonNode entry) {
        if (entry == null) return false;
        String status = entry.path("status").asText("");
        return "assumed".equals(status) || "verified".equals(status);
    }

    private static boolean label(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank();
    }

    /** The one canonical Account category projection; empty when the entry is missing or malformed. */
    private static Optional<AccountRules> account(JsonNode row, JsonNode config, int min, int max) {
        if (!assumed(row)) return Optional.empty();
        JsonNode v = row.get("value");
        if (!only(v, "schemaVersion", "minimumCategories", "importance", "understanding", "order", "categories")
                || !integer(v.get("schemaVersion")) || v.get("schemaVersion").intValue() != 1
                || !only(v.get("importance"), "medium", "high", "highFrom")) return Optional.empty();
        JsonNode imp = v.get("importance");
        for (String k : List.of("medium", "high", "highFrom")) {
            if (!integer(imp.get(k)) || imp.get(k).intValue() < min || imp.get(k).intValue() > max) return Optional.empty();
        }
        int medium = imp.get("medium").intValue();
        int high = imp.get("high").intValue();
        int highFrom = imp.get("highFrom").intValue();
        if (!(medium > min && medium < highFrom && highFrom <= high)) return Optional.empty();
        JsonNode order = v.get("order");
        JsonNode cats = v.get("categories");
        if (order == null || !order.isArray() || order.isEmpty() || !object(cats)) return Optional.empty();
        List<String> keys = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode k : order) {
            if (!k.isTextual() || !seen.add(k.asText())) return Optional.empty();
            keys.add(k.asText());
        }
        if (cats.size() != keys.size() || !integer(v.get("minimumCategories")) || v.get("minimumCategories").intValue() < 1
                || v.get("minimumCategories").intValue() > keys.size()) return Optional.empty();
        JsonNode u = v.get("understanding");
        if (!only(u, "kind", "maximum", "byConsidered", "sameAgain") || !"input-completeness".equals(u.path("kind").asText(null))
                || !integer(u.get("maximum")) || u.get("maximum").intValue() < 1 || !u.path("byConsidered").isArray()
                || u.get("byConsidered").size() != keys.size() + 1 || !integer(u.get("sameAgain"))) return Optional.empty();
        int umax = u.get("maximum").intValue();
        int previous = 0;
        for (int i = 0; i < u.get("byConsidered").size(); i++) {
            JsonNode n = u.get("byConsidered").get(i);
            if (!integer(n) || n.intValue() < 0 || n.intValue() > umax || (i > 0 && n.intValue() < previous)) return Optional.empty();
            previous = n.intValue();
        }
        int sameAgain = u.get("sameAgain").intValue();
        if (sameAgain < previous || sameAgain > umax) return Optional.empty();
        Map<String, JsonNode> categories = new LinkedHashMap<>();
        for (String key : keys) {
            JsonNode c = cats.get(key);
            JsonNode d = config.path("preferences").get(key);
            if (d == null || !object(c) || !label(c.get("label")) || !label(c.get("question"))) return Optional.empty();
            String kind = c.path("kind").asText("");
            if ("multi".equals(kind)) {
                if (!only(c, "label", "question", "kind", "options") || !"enum".equals(d.path("type").asText(""))
                        || !d.path("multiple").asBoolean(false) || !c.path("options").isArray() || c.get("options").isEmpty()) {
                    return Optional.empty();
                }
                int last = -1;
                for (JsonNode o : c.get("options")) {
                    int at = only(o, "value", "label") && label(o.get("label")) && d.path("values").isArray()
                            ? Json.indexOf(d.get("values"), o.get("value")) : -1;
                    if (at <= last) return Optional.empty();
                    last = at;
                }
            } else if ("stops".equals(kind)) {
                if (!only(c, "label", "question", "kind", "openDefault", "stops") || !"slider".equals(d.path("type").asText(""))
                        || !c.path("stops").isArray() || c.get("stops").size() < 2) return Optional.empty();
                int last = min - 1;
                boolean openFound = false;
                for (JsonNode o : c.get("stops")) {
                    if (!only(o, "value", "label") || !label(o.get("label")) || !integer(o.get("value"))
                            || o.get("value").intValue() <= last || o.get("value").intValue() > max) return Optional.empty();
                    last = o.get("value").intValue();
                    if (Json.same(o.get("value"), c.get("openDefault"))) openFound = true;
                }
                if (!openFound) return Optional.empty();
            } else {
                return Optional.empty();
            }
            categories.put(key, c);
        }
        return Optional.of(new AccountRules(medium, high, highFrom, v.get("minimumCategories").intValue(), keys, categories, u));
    }
}
