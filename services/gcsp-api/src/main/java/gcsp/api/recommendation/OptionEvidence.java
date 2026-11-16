package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/** Reviewed option evidence, from server/scenarios/employee/option-evidence.js.
 * Node's LRU cache is a performance device only and is not ported; outputs are identical. */
public final class OptionEvidence {

    private static final List<String> FIELDS = List.of("sportiness", "comfort", "economy", "size", "body", "fuel");
    private static final Pattern CODE = Pattern.compile("[A-Z0-9]+");

    private OptionEvidence() {}

    /** Derived evidence for one selected specification; groups keep the Node group objects. */
    public record Result(String version, String kind, boolean complete, double totalWeight, double score,
            double importance, Map<String, Double> adjustment, Map<String, List<String>> enumEvidence, ArrayNode groups) {

        public ObjectNode toJson() {
            ObjectNode adjusted = Js.obj();
            adjustment.forEach((k, v) -> adjusted.set(k, Js.num(v)));
            ObjectNode enums = Js.obj();
            enumEvidence.forEach((k, v) -> {
                ArrayNode list = Js.arr();
                v.forEach(list::add);
                enums.set(k, list);
            });
            return new Js.B().s("version", version).s("kind", kind).s("complete", complete).s("totalWeight", totalWeight)
                    .s("score", score).s("importance", importance).s("adjustment", adjusted).s("enumEvidence", enums)
                    .s("groups", groups).build();
        }
    }

    /** Null means an unknown specification. A null (undefined) policy keeps the original
     * calculation; an invalid policy throws like Node. */
    public static Result score(JsonNode selection, JsonNode policy, JsonNode preferences) {
        if (policy == null) return null;
        validatePolicy(policy, preferences);
        if (!validSelection(selection)) return null;
        return derive(selection, policy, preferences);
    }

    private static boolean codes(JsonNode value) {
        if (value == null || !value.isArray()) return false;
        for (JsonNode code : value) if (code == null || !code.isTextual() || !CODE.matcher(code.textValue()).matches()) return false;
        return true;
    }

    private static boolean numberIn(JsonNode n, double lo, double hi) {
        return Js.finite(n) && n.doubleValue() >= lo && n.doubleValue() <= hi;
    }

    private static void validatePolicy(JsonNode policy, JsonNode preferences) {
        if (!valid(policy, preferences)) throw new RecommendationFault("Invalid recommendation option evidence policy");
    }

    private static boolean valid(JsonNode policy, JsonNode preferences) {
        if (!Js.object(policy) || !Js.eqStr(policy.get("rule"), "reviewedEquipment.v1")
                || policy.get("version") == null || !policy.get("version").isTextual()
                || !Js.finite(policy.get("importance")) || policy.get("importance").doubleValue() != 100
                || !Js.finite(policy.get("halfSaturationWeight")) || policy.get("halfSaturationWeight").doubleValue() <= 0
                || !Js.finite(policy.get("sliderStep")) || policy.get("sliderStep").doubleValue() <= 0
                || !numberIn(policy.get("unknownModelAnchor"), 0, 100) || !numberIn(policy.get("maximumAdjustment"), 0, 100)
                || !Js.object(policy.get("options")) || !Js.object(policy.get("bundleFamilies")) || !Js.object(policy.get("disabledBy"))) {
            return false;
        }
        for (JsonNode list : policy.get("disabledBy")) if (!codes(list)) return false;
        for (JsonNode family : policy.get("bundleFamilies")) {
            if (!Js.object(family) || !strings(family.get("groups")) || !strings(family.get("members"))) return false;
        }
        for (JsonNode entry : policy.get("options")) {
            if (!Js.object(entry) || entry.get("group") == null || !entry.get("group").isTextual()
                    || !numberIn(entry.get("weight"), 0, 3)
                    || entry.get("bundle") != null && !entry.get("bundle").isBoolean()
                    || entry.get("requiresActivation") != null && !entry.get("requiresActivation").isBoolean()
                    || !Js.object(entry.get("evidence"))) {
                return false;
            }
            for (Map.Entry<String, JsonNode> e : Js.entries(entry.get("evidence"))) {
                if (!FIELDS.contains(e.getKey())) return false;
                JsonNode definition = Js.get(preferences, e.getKey());
                if (Js.eqStr(Js.opt(definition, "type"), "enum")) {
                    JsonNode values = Js.get(definition, "values");
                    if (values == null || !values.isArray() || !Js.includes(values, e.getValue())) return false;
                } else if (!numberIn(e.getValue(), -3, 3)) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean strings(JsonNode list) {
        if (list == null || !list.isArray()) return false;
        for (JsonNode item : list) if (!item.isTextual()) return false;
        return true;
    }

    private static boolean validSelection(JsonNode s) {
        if (!Js.object(s) || !(Js.eqStr(s.get("kind"), "selected-catalogue") || Js.eqStr(s.get("kind"), "verified-fitted"))
                || !codes(s.get("codes")) || !Js.isBool(s.get("complete"))) {
            return false;
        }
        JsonNode active = s.get("activeCodes");
        if (active == null) return true;
        if (!codes(active)) return false;
        for (JsonNode code : active) if (!Js.includes(s.get("codes"), code)) return false;
        return true;
    }

    /** Larger magnitude wins; on equal magnitude the smaller (more negative) value wins. */
    private static double stronger(Double left, double right) {
        double l = left == null ? 0 : left;
        return Math.abs(right) > Math.abs(l) || Math.abs(right) == Math.abs(l) && right < l ? right : l;
    }

    private record Group(String group, double[] weight, Map<String, Double> evidence, List<String> codes) {

        ObjectNode toJson() {
            ObjectNode ev = Js.obj();
            evidence.forEach((k, v) -> ev.set(k, Js.num(v)));
            ArrayNode list = Js.arr();
            codes.forEach(list::add);
            return new Js.B().s("group", group).s("weight", weight[0]).s("evidence", ev).s("codes", list).build();
        }
    }

    private static Result derive(JsonNode selection, JsonNode policy, JsonNode preferences) {
        Set<String> selected = new TreeSet<>();
        selection.get("codes").forEach(c -> selected.add(c.textValue()));
        Set<String> active = new TreeSet<>();
        if (selection.get("activeCodes") != null) selection.get("activeCodes").forEach(c -> active.add(c.textValue()));
        JsonNode options = policy.get("options");
        JsonNode disabledBy = policy.get("disabledBy");
        JsonNode families = policy.get("bundleFamilies");
        Map<String, Group> groups = new LinkedHashMap<>();
        Map<String, Group> bundles = new LinkedHashMap<>();
        Map<String, Set<String>> enums = new LinkedHashMap<>();
        for (String code : selected) {
            JsonNode entry = options.has(code) ? options.get(code) : null;
            if (entry == null) continue;
            if (Js.eqBool(entry.get("requiresActivation"), true) && !active.contains(code)) continue;
            JsonNode replacements = disabledBy.get(code);
            if (replacements != null && anySelected(replacements, selected)) continue;
            String group = entry.get("group").textValue();
            String family = null;
            if (Js.eqBool(entry.get("bundle"), true)) {
                for (Map.Entry<String, JsonNode> f : Js.entries(families)) {
                    if (Js.includes(f.getValue().get("groups"), group)) {
                        family = f.getKey();
                        break;
                    }
                }
            }
            Map<String, Group> map = family != null && !family.isEmpty() ? bundles : groups;
            String key = family != null ? family : group;
            Group prior = map.computeIfAbsent(key, k -> new Group(k, new double[] {0}, new LinkedHashMap<>(), new ArrayList<>()));
            prior.weight[0] = Math.max(prior.weight[0], entry.get("weight").doubleValue());
            prior.codes.add(code);
            for (Map.Entry<String, JsonNode> e : Js.entries(entry.get("evidence"))) {
                if (e.getValue().isTextual()) enums.computeIfAbsent(e.getKey(), k -> new LinkedHashSet<>()).add(e.getValue().textValue());
                else prior.evidence.put(e.getKey(), stronger(prior.evidence.get(e.getKey()), e.getValue().doubleValue()));
            }
        }
        double totalWeight = 0;
        for (Group g : groups.values()) totalWeight += g.weight[0];
        Map<String, Double> signals = new LinkedHashMap<>();
        for (String field : FIELDS) {
            if (!Js.eqStr(Js.opt(Js.get(preferences, field), "type"), "slider")) continue;
            double sum = 0;
            for (Group g : groups.values()) sum += g.evidence.getOrDefault(field, 0.0);
            signals.put(field, sum);
        }
        // Unresolved packs are a fallback, not an invented bill of materials.
        for (Map.Entry<String, Group> b : bundles.entrySet()) {
            Group bundle = b.getValue();
            JsonNode memberNames = families.get(b.getKey()).get("members");
            List<Group> members = new ArrayList<>();
            for (Group g : groups.values()) if (Js.includes(memberNames, g.group)) members.add(g);
            double memberWeight = 0;
            for (Group m : members) memberWeight += m.weight[0];
            totalWeight += Math.max(0, bundle.weight[0] - memberWeight);
            for (Map.Entry<String, Double> s : signals.entrySet()) {
                double value = bundle.evidence.getOrDefault(s.getKey(), 0.0);
                double represented = 0;
                for (Group m : members) represented += Math.max(0, m.evidence.getOrDefault(s.getKey(), 0.0) * Math.signum(value));
                s.setValue(s.getValue() + Math.signum(value) * Math.max(0, Math.abs(value) - represented));
            }
        }
        double halfSaturation = policy.get("halfSaturationWeight").doubleValue();
        double step = policy.get("sliderStep").doubleValue();
        double max = policy.get("maximumAdjustment").doubleValue();
        Map<String, Double> adjustment = new LinkedHashMap<>();
        signals.forEach((field, value) -> adjustment.put(field, Js.clampHigh(value * step, -max, max)));
        Map<String, List<String>> enumEvidence = new LinkedHashMap<>();
        enums.forEach((field, values) -> enumEvidence.put(field, new ArrayList<>(values)));
        ArrayNode all = Js.arr();
        groups.values().forEach(g -> all.add(g.toJson()));
        bundles.values().forEach(g -> all.add(g.toJson()));
        return new Result(policy.get("version").textValue(), selection.get("kind").textValue(),
                selection.get("complete").booleanValue(), totalWeight, 100 * totalWeight / (totalWeight + halfSaturation),
                policy.get("importance").doubleValue(), adjustment, enumEvidence, all);
    }

    private static boolean anySelected(JsonNode replacements, Set<String> selected) {
        for (JsonNode r : replacements) if (selected.contains(r.textValue())) return true;
        return false;
    }
}
