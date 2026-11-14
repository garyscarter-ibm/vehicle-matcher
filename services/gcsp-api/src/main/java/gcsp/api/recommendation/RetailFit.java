package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The numeric path of the retail rankCars for ONE car (fit, taste and match percentages), ported from
 * server/scenarios/retail/used-retail-v1.js, dimensions.js and recommendation/evaluate.js. Reason strings are
 * not computed. JS quirks are kept: undefined arithmetic gives NaN, and a missing container throws.
 */
final class RetailFit {

    /** How much of the match score is taste rather than fit (the Node default, TASTE_SHARE unset). */
    static final double TASTE_SHARE = 0.2;
    private static final Set<String> TASTE_DIMENSIONS = Set.of("character", "performance", "styleLine");
    private static final Map<String, double[]> BUDGET_BANDS = Map.of("b1", new double[] {0, 35000},
            "b2", new double[] {35000, 50000}, "b3", new double[] {50000, 70000}, "b4", new double[] {70000, 100000},
            "b5", new double[] {100000, 250000});
    private static final Map<String, Map<String, Double>> FUEL_TABLE = Map.of(
            "petrol", Map.of("petrol", 1.0, "diesel", 0.25, "phev", 0.3, "ev", 0.1),
            "diesel", Map.of("diesel", 1.0, "petrol", 0.25, "phev", 0.25, "ev", 0.1),
            "phev", Map.of("phev", 1.0, "ev", 0.35, "petrol", 0.25, "diesel", 0.2),
            "ev", Map.of("ev", 1.0, "phev", 0.3, "petrol", 0.05, "diesel", 0.05));
    private static final Map<String, Integer> PEOPLE_SPACE = Map.of("solo", 0, "family", 1, "crew", 2);
    private static final Map<String, Integer> USE_SPACE = Map.of("city", 0, "commute", 0, "fun", 0, "family", 1, "roadtrips", 1);
    private static final List<String> SPACE_KEYS = List.of("small", "medium", "big");
    private static final Map<String, List<String>> USE_TAGS = Map.of("fun", List.of("drivers-car"),
            "family", List.of("family", "practical"), "commute", List.of("efficient", "cruiser"),
            "city", List.of("urban"), "roadtrips", List.of("cruiser"));
    private static final Map<String, Double> MILEAGE_BANDS = Map.of("low", 0.0, "mid", 0.35, "high", 0.7, "vhigh", 1.0);

    private RetailFit() {}

    /** Match, fit and taste percentages of the single car. */
    record Fit(double score, double fit, double taste) {

        /** ranked[component]: fit, taste and score are numbers; any other member is treated as undefined (NaN). */
        double component(String name) {
            return switch (name) {
                case "fit" -> fit;
                case "taste" -> taste;
                case "score" -> score;
                default -> Double.NaN;
            };
        }
    }

    /** rankCars(answers, [car], tuning)[0]; null when the hard filters drop the car (the Node result is []). */
    static Fit rank(JsonNode answers, JsonNode car, JsonNode tuning) {
        Map<String, Double> fitW = fitWeights(answers, tuning);
        Map<String, Double> tasteW = tasteWeights(answers, tuning);
        double fitTotal = total(fitW);
        double tasteTotal = total(tasteW);
        if (!passesHardFilters(car, answers, tuning)) return null;
        double fitWeighted = 0;
        double tasteWeighted = 0;
        for (String dimension : List.of("budget", "body", "fuel", "practicality", "performance", "economy", "size",
                "character", "styleLine", "doors")) {
            double weight = fitW.getOrDefault(dimension, 0.0) + tasteW.getOrDefault(dimension, 0.0);
            if (weight == 0) continue;
            double score = scorer(dimension, car, answers, tuning);
            Double fw = fitW.get(dimension);
            if (fw != null && Js.truthy(fw)) fitWeighted += fw * score;
            Double tw = tasteW.get(dimension);
            if (tw != null && Js.truthy(tw)) tasteWeighted += tw * score;
        }
        double ratio = fitWeighted / fitTotal;
        if (Js.eqStr(answers.get("people"), "crew")
                && rel(car.get("seats"), Js.get(Js.get(tuning, "practicality"), "crewBonusSeats")) < 0) {
            JsonNode shortfall = tuning.get("crewSeatShortfall");
            ratio *= Js.nullish(shortfall) ? 1 : Js.toNumber(shortfall);
        }
        double tasteRatio = Js.truthy(tasteTotal) ? tasteWeighted / tasteTotal : 0;
        double score = Js.round((ratio * (1 - TASTE_SHARE) + tasteRatio * TASTE_SHARE) * 100);
        return new Fit(score, Js.round(ratio * 100), Js.round(tasteRatio * 100));
    }

    private static double rel(JsonNode a, JsonNode b) {
        return Js.rel(a, b);
    }

    private static double total(Map<String, Double> weights) {
        double sum = 0;
        for (double v : weights.values()) sum += v;
        return sum;
    }

    private static double num(JsonNode n) {
        return Js.toNumber(n);
    }

    private static double clamp(double v) {
        return Js.clamp(v, 0, 1);
    }

    // ---- weights ---------------------------------------------------------------------------------------------

    private static Map<String, Double> fitWeights(JsonNode answers, JsonNode tuning) {
        Map<String, Double> w = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : Js.entries(Js.get(tuning, "weights"))) {
            if (!TASTE_DIMENSIONS.contains(e.getKey())) w.put(e.getKey(), num(e.getValue()));
        }
        w.put("economy", w.getOrDefault("economy", Double.NaN) + mileageFraction(answers, tuning));
        List<JsonNode> prefs = fuelPrefs(answers);
        if (!Js.listHas(prefs, Js.F.textNode("open"))) {
            w.put("fuel", w.getOrDefault("fuel", Double.NaN) + num(Js.get(tuning, "fuelStrictBoost")));
        }
        JsonNode doors = answers.get("doors");
        if (!Js.truthy(doors) || Js.eqStr(doors, "either")) w.remove("doors");
        return w;
    }

    private static Map<String, Double> tasteWeights(JsonNode answers, JsonNode tuning) {
        Map<String, Double> w = new LinkedHashMap<>();
        JsonNode weights = Js.get(tuning, "weights");
        for (String dim : List.of("character", "performance", "styleLine")) {
            JsonNode value = Js.get(weights, dim);
            if (!Js.nullish(value)) w.put(dim, num(value));
        }
        for (JsonNode p : priorities(answers)) {
            JsonNode boosts = Js.prop(Js.get(tuning, "priorityBoosts"), Js.key(p));
            if (!Js.truthy(boosts)) continue;
            for (Map.Entry<String, JsonNode> b : Js.entries(boosts)) {
                if (w.containsKey(b.getKey())) w.put(b.getKey(), w.get(b.getKey()) + num(b.getValue()));
            }
        }
        double style = num(answers.get("style"));
        if (style >= 4) w.put("performance", w.getOrDefault("performance", Double.NaN) + 1);
        if (style <= 2) w.put("performance", Math.max(0.5, w.getOrDefault("performance", Double.NaN) - 0.5));
        if (!Js.truthy(answers.get("styleLine"))) w.remove("styleLine");
        return w;
    }

    /** `answers.priorities || []`; a truthy non-array is outside the contract and faults. */
    private static Iterable<JsonNode> priorities(JsonNode answers) {
        JsonNode p = answers.get("priorities");
        if (!Js.truthy(p)) return List.of();
        if (!p.isArray()) throw new RecommendationFault("priorities is not iterable");
        return p;
    }

    // ---- answers ---------------------------------------------------------------------------------------------

    private static double mileageFraction(JsonNode answers, JsonNode tuning) {
        JsonNode mileage = Js.destructure(Js.get(tuning, "mileage"));
        double low = num(Js.get(mileage, "lowMiles"));
        double high = num(Js.get(mileage, "highMiles"));
        JsonNode m = answers.get("mileage");
        if (m != null && m.isNumber()) return clamp((m.doubleValue() - low) / (high - low));
        return MILEAGE_BANDS.getOrDefault(Js.key(m), 0.0);
    }

    private static List<JsonNode> fuelPrefs(JsonNode answers) {
        JsonNode f = answers.get("fuel");
        List<JsonNode> picks = new java.util.ArrayList<>();
        if (f != null && f.isArray()) f.forEach(picks::add);
        else if (!Js.nullish(f)) picks.add(f);
        if (picks.isEmpty()) picks.add(Js.F.textNode("open"));
        return picks;
    }

    private static boolean canChargeAt(JsonNode charging) {
        return Js.eqStr(charging, "home") || Js.eqStr(charging, "work") || Js.eqStr(charging, "either");
    }

    /** budgetRange: [min, max], or null for anything unusable. */
    private static double[] budgetRange(JsonNode answers) {
        JsonNode b = answers.get("budget");
        if (b != null && b.isArray() && b.size() == 2) {
            double lo = num(b.get(0));
            double hi = num(b.get(1));
            if (Double.isFinite(lo) && Double.isFinite(hi) && hi > 0) return new double[] {Math.max(0, Math.min(lo, hi)), Math.max(lo, hi)};
            return null;
        }
        if (b != null && b.isNumber() && Double.isFinite(b.doubleValue()) && b.doubleValue() > 0) return new double[] {0, b.doubleValue()};
        return b != null && b.isTextual() ? BUDGET_BANDS.get(b.textValue()) : null;
    }

    private static boolean passesHardFilters(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode hard = Js.destructure(Js.get(tuning, "hardFilter"));
        JsonNode crewBoot = Js.get(hard, "crewBoot");
        JsonNode crewSeats = Js.get(hard, "crewSeats");
        JsonNode familySeats = Js.get(hard, "familySeats");
        if (!Js.eqBool(tuning.get("retailBudgetEnabled"), false)) {
            double[] range = Js.requireNonNull(budgetRange(answers));
            if (Js.rel(car.get("priceMin"), range[1] * num(Js.get(tuning, "stretchFactor"))) > 0) return false;
        }
        JsonNode people = answers.get("people");
        if (Js.eqStr(people, "crew") && (rel(car.get("seats"), crewSeats) < 0 || rel(car.get("boot"), crewBoot) < 0)) return false;
        return !(Js.eqStr(people, "family") && rel(car.get("seats"), familySeats) < 0);
    }

    // ---- scorers ---------------------------------------------------------------------------------------------

    private static double scorer(String dimension, JsonNode car, JsonNode answers, JsonNode tuning) {
        return switch (dimension) {
            case "budget" -> scoreBudget(car, answers);
            case "body" -> scoreBody(car, answers, tuning);
            case "fuel" -> scoreFuel(car, answers, tuning);
            case "practicality" -> scorePracticality(car, answers, tuning);
            case "performance" -> scorePerformance(car, answers, tuning);
            case "economy" -> scoreEconomy(car, answers, tuning);
            case "size" -> scoreSize(car, answers, tuning);
            case "character" -> scoreCharacter(car, answers);
            case "styleLine" -> scoreStyleLine(car, answers, tuning);
            default -> scoreDoors(car, answers, tuning);
        };
    }

    private static double scoreBudget(JsonNode car, JsonNode answers) {
        double[] range = Js.requireNonNull(budgetRange(answers));
        double min = range[0];
        double max = range[1];
        JsonNode priceMin = car.get("priceMin");
        JsonNode priceMax = car.get("priceMax");
        if (Js.rel(priceMin, max) > 0) return 0.35;
        if (Js.rel(priceMax, max) <= 0 && Js.rel(priceMax, min) >= 0) return 1;
        if (Js.rel(priceMax, min) < 0) {
            if (min == 0) return 0.7;
            double shortfall = (min - num(priceMax)) / min;
            return Js.clamp(0.7 - shortfall, 0.1, 0.7);
        }
        return 0.75;
    }

    private static double scoreBody(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode b = Js.destructure(Js.get(tuning, "body"));
        JsonNode picks = answers.get("bodyStyles");
        if (!Js.truthy(picks)) picks = Js.arr();
        if (!picks.isArray()) throw new RecommendationFault("bodyStyles is not an array");
        if (picks.size() == 0 || Js.includes(picks, "any")) return num(Js.get(b, "neutral"));
        return Js.includes(picks, car.get("body")) ? num(Js.get(b, "match")) : num(Js.get(b, "miss"));
    }

    private static double scoreOneFuel(JsonNode pref, JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode charging = Js.truthy(answers.get("charging")) ? answers.get("charging") : Js.F.textNode("none");
        boolean canCharge = canChargeAt(charging);
        double evAccess = Js.eqStr(charging, "home") || Js.eqStr(charging, "either") ? 1 : Js.eqStr(charging, "work") ? 0.85 : 0.3;
        JsonNode fuel = car.get("fuel");
        if (Js.eqStr(pref, "open")) {
            if (Js.eqStr(fuel, "ev")) return canCharge ? 0.95 : 0.25;
            if (Js.eqStr(fuel, "phev")) return canCharge ? 0.85 : 0.6;
            if (Js.eqStr(fuel, "diesel")) return mileageFraction(answers, tuning) >= 0.66 ? 0.9 : 0.55;
            return 0.7;
        }
        Map<String, Double> row = pref != null && pref.isTextual() ? FUEL_TABLE.get(pref.textValue()) : null;
        if (row == null) throw new RecommendationFault("Cannot read a fuel preference row");
        Double base = fuel != null && fuel.isTextual() ? row.get(fuel.textValue()) : null;
        double score = base == null ? Double.NaN : base;
        if (Js.eqStr(fuel, "ev")) score *= evAccess;
        if (Js.eqStr(fuel, "phev") && !canCharge) score *= 0.7;
        return score;
    }

    private static double scoreFuel(JsonNode car, JsonNode answers, JsonNode tuning) {
        double best = -1;
        for (JsonNode pref : fuelPrefs(answers)) {
            double score = scoreOneFuel(pref, car, answers, tuning);
            if (score > best) best = score;
        }
        return best;
    }

    private static double scorePracticality(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode practicality = Js.destructure(Js.get(tuning, "practicality"));
        JsonNode bootNeed = Js.destructure(Js.get(practicality, "bootNeed"));
        JsonNode seatsFloor = Js.get(practicality, "seatsFloor");
        JsonNode crewBonusSeats = Js.get(practicality, "crewBonusSeats");
        JsonNode people = answers.get("people");
        int level = space(PEOPLE_SPACE, people) + space(USE_SPACE, answers.get("primaryUse"));
        JsonNode need = Js.get(bootNeed, SPACE_KEYS.get(Math.min(level, SPACE_KEYS.size() - 1)));
        double needValue = Js.nullish(need) ? 0 : num(need);
        boolean needZero = Js.nullish(need) || need.isNumber() && needValue == 0;
        boolean seatsOk = Js.eqStr(people, "solo") || Js.rel(car.get("seats"), seatsFloor) >= 0;
        double score = needZero ? 1 : clamp(num(car.get("boot")) / needValue);
        if (!seatsOk) score *= 0.3;
        if (Js.eqStr(people, "crew") && Js.rel(car.get("seats"), crewBonusSeats) >= 0) return 1;
        return score;
    }

    private static int space(Map<String, Integer> table, JsonNode key) {
        Integer v = key != null && key.isTextual() ? table.get(key.textValue()) : null;
        return v == null ? 0 : v;
    }

    private static double scorePerformance(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode perf = Js.destructure(Js.get(tuning, "performance"));
        double zeroBase = num(Js.get(perf, "zeroBase"));
        double span = num(Js.get(perf, "span"));
        boolean wantsIt = num(answers.get("style")) >= 4 || includesPerformance(answers);
        double base = wantsIt ? zeroBase - 3 : zeroBase;
        double range = wantsIt ? span - 2 : span;
        return clamp((base - num(car.get("zeroTo62"))) / range);
    }

    private static boolean includesPerformance(JsonNode answers) {
        for (JsonNode p : priorities(answers)) if (Js.eqStr(p, "performance")) return true;
        return false;
    }

    private static double scoreEconomy(JsonNode car, JsonNode answers, JsonNode tuning) {
        boolean canCharge = canChargeAt(answers.get("charging"));
        double miles = mileageFraction(answers, tuning);
        JsonNode fuel = car.get("fuel");
        if (Js.eqStr(fuel, "ev")) return canCharge ? 1 : clamp(0.5 + 0.2 * miles);
        if (Js.eqStr(fuel, "phev")) return canCharge ? clamp(0.85 + 0.1 * miles) : clamp(0.6 - 0.1 * miles);
        double mpg = num(car.get("mpg"));
        if (!Double.isFinite(mpg)) return 0.5;
        double base = clamp((mpg - 25) / 35);
        return clamp(base + (base - 0.5) * miles);
    }

    private static double scoreSize(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode size = Js.destructure(Js.get(tuning, "size"));
        JsonNode roadtripMinClass = Js.get(size, "roadtripMinClass");
        double cityDivisor = num(Js.get(size, "cityDivisor"));
        JsonNode use = answers.get("primaryUse");
        if (Js.eqStr(use, "city")) return clamp((cityDivisor + 1 - num(car.get("sizeClass"))) / cityDivisor);
        if (Js.eqStr(use, "roadtrips")) return Js.rel(car.get("sizeClass"), roadtripMinClass) >= 0 ? 1 : 0.6;
        return 0.7;
    }

    private static double scoreCharacter(JsonNode car, JsonNode answers) {
        JsonNode use = answers.get("primaryUse");
        java.util.HashSet<String> wanted = new java.util.HashSet<>(
                use != null && use.isTextual() ? USE_TAGS.getOrDefault(use.textValue(), List.of()) : List.of());
        double style = num(answers.get("style"));
        if (style >= 4) wanted.add("drivers-car");
        if (style <= 2) wanted.add("cruiser");
        for (JsonNode p : priorities(answers)) {
            if (Js.eqStr(p, "tech")) wanted.add("tech");
            if (Js.eqStr(p, "image")) wanted.add("image");
            if (Js.eqStr(p, "comfort")) wanted.add("cruiser");
            if (Js.eqStr(p, "economy")) wanted.add("efficient");
            if (Js.eqStr(p, "performance")) wanted.add("drivers-car");
        }
        JsonNode tags = car.get("tags");
        if (tags == null || !tags.isArray()) throw new RecommendationFault("car.tags.filter is not a function");
        int hits = 0;
        for (JsonNode t : tags) if (t.isTextual() && wanted.contains(t.textValue())) hits++;
        return clamp(hits / 2.0);
    }

    private static double scoreStyleLine(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode cfg = tuning.get("styleLine");
        JsonNode want = answers.get("styleLine");
        JsonNode trim = car.get("styleLine");
        if (!Js.truthy(cfg) || !Js.truthy(want) || !Js.truthy(trim)) return neutral(cfg);
        boolean hit = Js.eqStr(want, "sport") ? Js.eqStr(trim, "sport") || Js.eqStr(trim, "jcw") : Js.strictEq(trim, want);
        return num(Js.get(cfg, hit ? "match" : "miss"));
    }

    private static double scoreDoors(JsonNode car, JsonNode answers, JsonNode tuning) {
        JsonNode cfg = tuning.get("doors");
        double want = num(answers.get("doors"));
        if (!Js.truthy(cfg) || !Js.truthy(want) || !Js.truthy(car.get("doors"))) return neutral(cfg);
        boolean same = car.get("doors").isNumber() && car.get("doors").doubleValue() == want;
        return num(Js.get(cfg, same ? "match" : "miss"));
    }

    /** `cfg?.neutral ?? 0.7`. */
    private static double neutral(JsonNode cfg) {
        JsonNode n = Js.opt(cfg, "neutral");
        return Js.nullish(n) ? 0.7 : num(n);
    }
}
