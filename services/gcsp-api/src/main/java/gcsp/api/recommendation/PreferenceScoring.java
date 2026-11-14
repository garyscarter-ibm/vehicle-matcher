package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Preference fit for one car and brief, ported from scorePreferences in server/scenarios/employee/index.js. */
public final class PreferenceScoring {

    private PreferenceScoring() {}

    /** One scored component: its JSON evidence, plus the number and weight the average uses. */
    private record Component(ObjectNode json, double score, double weight) {}

    /**
     * Returns {score, components, unknowns, reasons, tradeOffs}. Throws RecommendationFault where Node throws
     * (invalid preference weights, a car the hard filters drop, a missing container); callers map that to unavailable.
     */
    public static ObjectNode score(JsonNode snapshot, JsonNode brief, JsonNode employeeFacts, RecommendationConfig config, Slider slider) {
        ArrayNode unknowns = Js.arr();
        ArrayNode reasons = Js.arr();
        ArrayNode tradeOffs = Js.arr();
        List<Component> components = new ArrayList<>();
        JsonNode weights = config.read("preferenceWeights");
        checkWeights(weights, config);
        JsonNode facts = Js.get(snapshot, "facts");
        ObjectNode car = Js.obj();
        JsonNode name = Js.get(Js.get(snapshot, "display"), "name");
        if (name != null) car.set("name", name);
        for (Map.Entry<String, JsonNode> fact : Js.entries(facts)) {
            if (Js.eqStr(Js.get(fact.getValue(), "status"), "known")) {
                JsonNode value = fact.getValue().get("value");
                if (value != null) car.set(fact.getKey(), value);
                else car.remove(fact.getKey());
            }
        }
        JsonNode optionSelection = Js.get(facts, "optionSelection");
        OptionEvidence.Result options = OptionEvidence.score(
                Gates.confirmedFact(optionSelection, config) ? optionSelection.get("value") : Js.F.nullNode(),
                config.read("optionEvidence"), config.read("preferences"));
        JsonNode plugInFuels = config.read("plugInFuels");
        for (Map.Entry<String, JsonNode> entry : Js.entries(Js.get(brief, "preferences"))) {
            String key = entry.getKey();
            JsonNode preference = entry.getValue();
            if (Gates.unselectedPreference(preference)) continue;
            JsonNode importance = Js.get(preference, "importance");
            if (Js.strictEq(importance, Js.F.numberNode(slider.minimum()))) continue;
            if (!Js.eqStr(preference.get("valueState"), "confirmed") || !Js.eqStr(preference.get("importanceState"), "confirmed")) {
                unknowns.add(new Js.B().s("code", "preference-unconfirmed").s("field", key).s("preference", preference).build());
                continue;
            }
            JsonNode d = Js.get(config.read("preferences"), key);
            ArrayNode fields = Js.arr();
            for (JsonNode field : Js.array(Js.get(d, "facts"))) {
                if (!(key.equals("economy") && Js.eqStr(field, "mpg") && Js.includes(plugInFuels, car.get("fuel")))) fields.add(field);
            }
            boolean incomplete = false;
            for (JsonNode field : fields) {
                if (!Js.eqStr(Js.opt(Js.get(facts, Js.key(field)), "status"), "known")) incomplete = true;
            }
            JsonNode type = Js.get(d, "type");
            JsonNode optionEvidence = config.read("optionEvidence");
            double modelObserved;
            if (incomplete) {
                unknowns.add(new Js.B().s("code", "preference-fact-unknown").s("field", key).s("facts", fields).build());
                if (!Js.eqStr(type, "slider") || optionEvidence == null
                        || (!key.equals("sportiness") && !(options != null && Js.truthy(adjustmentOf(options, key))))) {
                    continue;
                }
                modelObserved = Js.toNumber(Js.get(optionEvidence, "unknownModelAnchor"));
            } else {
                modelObserved = modelObserved(key, d, preference, car, employeeFacts, config, slider);
            }
            double adjustment = options == null || !options.adjustment().containsKey(key) ? 0 : options.adjustment().get(key);
            if (Js.eqStr(type, "enum") && options != null && options.enumEvidence().containsKey(key)
                    && anyChosen(options.enumEvidence().get(key), preference.get("value"))
                    && (!key.equals("fuel") || Js.includes(plugInFuels, car.get("fuel")))) {
                adjustment = Js.toNumber(Js.get(optionEvidence, "sliderStep"));
            }
            double observed = Js.clampHigh(modelObserved + adjustment, slider.minimum(), slider.maximum());
            if (!Double.isFinite(observed)) {
                unknowns.add(new Js.B().s("code", "preference-fact-unknown").s("field", key).s("facts", fields).build());
                continue;
            }
            double score = Js.eqStr(type, "slider") ? slider.maximum() - Math.abs(Js.toNumber(preference.get("value")) - observed) : observed;
            double importanceValue = Js.toNumber(importance);
            double policyWeight = weights == null ? 1 : weights.get(key).doubleValue();
            double effective = importanceValue * policyWeight;
            ObjectNode evidence = new Js.B().s("code", "preference-fit").s("field", key).s("score", score).s("importance", importance).build();
            if (weights != null) {
                evidence.set("policyWeight", Js.num(policyWeight));
                evidence.set("effectiveImportance", Js.num(effective));
            }
            if (incomplete) evidence.put("modelFactsIncomplete", true);
            if (options != null && Js.truthy(adjustment)) {
                ArrayNode groups = Js.arr();
                for (JsonNode group : options.groups()) if (Js.truthy(Js.opt(group.get("evidence"), key))) groups.add(group);
                evidence.set("modelObserved", Js.num(modelObserved));
                evidence.set("optionEvidence", new Js.B().s("version", options.version()).s("kind", options.kind())
                        .s("adjustment", adjustment).s("groups", groups).build());
            }
            JsonNode desired = preference.get("value");
            if (desired != null) evidence.set("desired", desired);
            evidence.set("observed", Js.num(observed));
            ObjectNode held = Js.obj();
            for (JsonNode field : fields) {
                JsonNode fact = Js.get(facts, Js.key(field));
                if (fact != null) held.set(Js.key(field), fact);
            }
            evidence.set("facts", held);
            components.add(new Component(evidence, score, weights == null ? importanceValue : effective));
            (score == slider.maximum() ? reasons : tradeOffs).add(evidence);
        }
        // The hidden specification-fit weighs like another importance-100 preference but is never shown.
        if (options != null && options.complete()) {
            ObjectNode hidden = new Js.B().s("code", "specification-fit").s("field", "wellSpecified").s("hidden", true)
                    .s("score", options.score()).s("importance", options.importance()).s("totalWeight", options.totalWeight())
                    .s("mappingVersion", options.version()).s("selectionKind", options.kind()).build();
            components.add(new Component(hidden, options.score(), options.importance()));
        }
        double importance = 0;
        for (Component c : components) importance += c.weight();
        double numerator = 0;
        for (Component c : components) numerator += c.score() * c.weight();
        ArrayNode json = Js.arr();
        components.forEach(c -> json.add(c.json()));
        ObjectNode out = Js.obj();
        out.set("score", Js.truthy(importance) ? Js.num(Js.round(numerator / importance)) : Js.F.nullNode());
        out.set("components", json);
        out.set("unknowns", unknowns);
        out.set("reasons", reasons);
        out.set("tradeOffs", tradeOffs);
        return out;
    }

    private static JsonNode adjustmentOf(OptionEvidence.Result options, String key) {
        Double value = options.adjustment().get(key);
        return value == null ? null : Js.F.numberNode(value);
    }

    private static boolean anyChosen(List<String> evidence, JsonNode value) {
        ArrayNode chosen = BriefRules.choiceList(value);
        for (String e : evidence) if (Js.includes(chosen, e)) return true;
        return false;
    }

    /** Optional preferenceWeights must name every preference with a non-negative safe integer weight. */
    private static void checkWeights(JsonNode weights, RecommendationConfig config) {
        if (weights == null) return;
        JsonNode preferences = config.read("preferences");
        boolean bad = !Js.truthy(weights) || !weights.isObject() || Js.keyCount(weights) != Js.keyCount(preferences);
        if (!bad) {
            for (Map.Entry<String, JsonNode> p : Js.entries(preferences)) {
                if (!Js.hasOwn(weights, p.getKey()) || !Js.safeInt(weights.get(p.getKey())) || weights.get(p.getKey()).doubleValue() < 0) bad = true;
            }
        }
        if (bad) throw new RecommendationFault("Invalid recommendation preference weights");
    }

    /** The retail engine's fit or taste percentage for the one car, clipped to the slider maximum. */
    private static double modelObserved(String key, JsonNode d, JsonNode preference, ObjectNode car, JsonNode employeeFacts,
            RecommendationConfig config, Slider slider) {
        ObjectNode answers = Js.obj();
        JsonNode base = Js.get(d, "answers");
        if (base != null && base.isObject()) base.fields().forEachRemaining(e -> answers.set(e.getKey(), e.getValue()));
        JsonNode answer = Js.get(d, "answer");
        if (Js.truthy(answer)) answers.set(Js.key(answer), BriefRules.choiceList(preference.get("value")));
        JsonNode charging = Js.get(employeeFacts, "charging");
        if (Gates.confirmedFact(charging, config)) answers.set("charging", Js.orNull(charging.get("value")));
        if (key.equals("economy") && Gates.confirmedFact(Js.get(employeeFacts, "annualMileage"), config)) {
            answers.set("mileage", Js.orNull(employeeFacts.get("annualMileage").get("value")));
        }
        ObjectNode tuning = Js.obj();
        JsonNode configTuning = config.read("tuning");
        if (configTuning != null && configTuning.isObject()) configTuning.fields().forEachRemaining(e -> tuning.set(e.getKey(), e.getValue()));
        JsonNode retail = config.read("retailBudgetEnabled");
        if (retail != null) tuning.set("retailBudgetEnabled", retail);
        else tuning.remove("retailBudgetEnabled");
        ObjectNode weights = Js.obj();
        weights.put("body", Js.eqStr(Js.get(d, "component"), "taste") ? 1 : 0);
        weights.put("economy", 0);
        weights.put("performance", 0);
        weights.put(Js.key(Js.get(d, "dimension")), 1);
        tuning.set("weights", weights);
        RetailFit.Fit ranked = RetailFit.rank(answers, car, tuning);
        if (ranked == null) throw new RecommendationFault("No retail match for the car");
        JsonNode multiplier = Js.get(d, "scaleMultiplier");
        double scale = Js.nullish(multiplier) ? 1 : Js.toNumber(multiplier);
        return Math.min(slider.maximum(), ranked.component(Js.key(Js.get(d, "component"))) * scale);
    }
}
