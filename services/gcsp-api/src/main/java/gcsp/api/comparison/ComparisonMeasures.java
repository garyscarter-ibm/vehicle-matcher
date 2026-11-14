package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.safeInteger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalLong;
import java.util.TreeMap;
import java.util.TreeSet;

/** Port of the Node comparison measures: same double arithmetic, same rounding, same verdicts. */
public final class ComparisonMeasures {

    public static final String RULE_KEY = "comparison.noClearDifferenceRule";
    public static final List<String> MEASURE_NAMES = List.of("acceptableCoverage", "carsNeverAllocated",
            "heldNotTakenCarDays", "declinedOffers", "expiredOffers", "failedClaims", "retries", "meanAcceptedFit",
            "accessGroupCoverage");
    private static final List<String> SCALAR_MEASURES = MEASURE_NAMES.subList(0, MEASURE_NAMES.size() - 1);
    private static final String GROUP_PREFIX = "accessGroupCoverage:";
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private ComparisonMeasures() {}

    /** Math.round(x * 10^places) / 10^places + 0, so a rounded -0 reads as 0. */
    static double round(double number, int places) {
        double scale = Math.pow(10, places);
        return ComparisonValidation.round(number * scale) / scale + 0;
    }

    static double round(double number) {
        return round(number, 6);
    }

    /** A JSON number as JS would print it: whole values as integers, non-finite as null. */
    static JsonNode num(double value) {
        if (!Double.isFinite(value)) return JSON.nullNode();
        return value == Math.rint(value) && Math.abs(value) < 9.007199254740992E15
                ? JSON.numberNode((long) value) : JSON.numberNode(value);
    }

    private static JsonNode nullable(Double value) {
        return value == null ? JSON.nullNode() : num(value);
    }

    private static boolean numeric(JsonNode node) {
        return node != null && node.isNumber() && Double.isFinite(node.doubleValue());
    }

    private static boolean truthy(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) return false;
        if (node.isBoolean()) return node.booleanValue();
        if (node.isNumber()) return node.doubleValue() != 0 && !Double.isNaN(node.doubleValue());
        return !node.isTextual() || !node.textValue().isEmpty();
    }

    private static ComparisonRunError refuse(String boundary) {
        return new ComparisonRunError("invalid-input", boundary);
    }

    private static OptionalLong time(JsonNode node) {
        if (node == null || !node.isTextual()) return OptionalLong.empty();
        OptionalLong parsed = ComparisonValidation.parseInstant(node.textValue());
        if (parsed.isPresent()) return parsed;
        try {
            return OptionalLong.of(Instant.parse(node.textValue()).toEpochMilli());
        } catch (RuntimeException e) {
            return OptionalLong.empty();
        }
    }

    /** Taken by renewal with underlying calculated fit at or above the record's threshold. */
    private static boolean covered(JsonNode row, double threshold) {
        JsonNode outcome = row.get("outcome");
        if (outcome == null || !outcome.isTextual() || !outcome.textValue().equals("taken")) return false;
        OptionalLong taken = time(row.get("takenAt"));
        OptionalLong renewal = time(row.get("renewalAt"));
        if (taken.isEmpty() || renewal.isEmpty() || taken.getAsLong() > renewal.getAsLong()) return false;
        JsonNode fit = row.get("fit");
        JsonNode underlying = fit == null ? null : fit.get("underlying");
        return numeric(underlying) && underlying.doubleValue() >= threshold;
    }

    private static String groupName(JsonNode node) {
        if (node == null || node.isMissingNode()) return "undefined";
        return node.isTextual() ? node.textValue() : node.isNull() ? "null" : node.asText();
    }

    /** The per-route measures of one outcome record. */
    public static ObjectNode routeMeasures(JsonNode record) {
        JsonNode route = record == null ? null : record.get("route");
        JsonNode employees = record == null ? null : record.get("employees");
        JsonNode cars = record == null ? null : record.get("cars");
        JsonNode threshold = record == null ? null : record.get("threshold");
        JsonNode totals = record == null ? null : record.get("totals");
        if (!truthy(record) || route == null || !route.isTextual()
                || !(route.textValue().equals("current") || route.textValue().equals("buddy"))
                || employees == null || !employees.isArray() || cars == null || !cars.isArray() || !numeric(threshold)
                || !truthy(totals)) {
            throw refuse("outcome-record");
        }
        double limit = threshold.doubleValue();
        int acceptable = 0;
        double fitSum = 0;
        TreeMap<String, int[]> groups = new TreeMap<>();
        for (JsonNode row : employees) {
            int[] group = groups.computeIfAbsent(groupName(row.get("accessGroup")), k -> new int[2]);
            group[0]++;
            if (covered(row, limit)) {
                group[1]++;
                acceptable++;
                fitSum += row.get("fit").get("underlying").doubleValue();
            }
        }
        double carDays;
        if (route.textValue().equals("buddy")) {
            carDays = numberOr(totals.get("heldNotTakenHours"), Double.NaN) / 24;
        } else {
            carDays = 0;
            for (JsonNode car : cars) carDays += numberOr(car.get("heldNotTakenSeconds"), Double.NaN) / 86400;
        }
        int neverAllocated = 0;
        for (JsonNode car : cars) {
            JsonNode outcome = car.get("outcome");
            if (outcome == null || !outcome.isTextual() || !outcome.textValue().equals("allocated")) neverAllocated++;
        }
        ObjectNode out = JSON.objectNode();
        out.set("acceptableCoverage", employees.size() > 0 ? num(round((double) acceptable / employees.size())) : JSON.nullNode());
        out.put("carsNeverAllocated", neverAllocated);
        out.set("heldNotTakenCarDays", num(round(carDays)));
        out.set("declinedOffers", orZero(totals.get("declines")));
        out.set("expiredOffers", orZero(totals.get("offerExpiries")));
        if (totals.get("expiries") != null) out.set("failedClaims", totals.get("expiries").deepCopy());
        if (totals.get("retries") != null) out.set("retries", totals.get("retries").deepCopy());
        out.set("meanAcceptedFit", acceptable > 0 ? num(round(fitSum / acceptable, 2)) : JSON.nullNode());
        ObjectNode coverage = out.putObject("accessGroupCoverage");
        groups.forEach((id, g) -> coverage.set(id, num(round((double) g[1] / g[0]))));
        return out;
    }

    private static double numberOr(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.doubleValue() : fallback;
    }

    private static JsonNode orZero(JsonNode node) {
        return node == null || node.isNull() ? JSON.numberNode(0) : node.deepCopy();
    }

    /** Mean, minimum, maximum and count over the seeds that observed a measure. */
    record Summary(Double mean, Double min, Double max, int observed) {

        static Summary of(List<JsonNode> values) {
            List<Double> seen = new ArrayList<>();
            if (values != null) {
                for (JsonNode value : values) if (numeric(value)) seen.add(value.doubleValue());
            }
            if (seen.isEmpty()) return new Summary(null, null, null, 0);
            double sum = 0;
            double min = seen.get(0);
            double max = seen.get(0);
            for (double v : seen) {
                sum += v;
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
            return new Summary(round(sum / seen.size()), min, max, seen.size());
        }

        ObjectNode toJson() {
            ObjectNode out = JSON.objectNode();
            out.set("mean", nullable(mean));
            out.set("min", nullable(min));
            out.set("max", nullable(max));
            out.put("observedSeeds", observed);
            return out;
        }
    }

    public static ObjectNode summariseSeeds(List<JsonNode> values) {
        return Summary.of(values).toJson();
    }

    /** The per-route summary of an armed run: every scalar measure, then each access group seen. */
    public static ObjectNode routeSummary(JsonNode perSeed, String route) {
        ObjectNode out = JSON.objectNode();
        for (String name : SCALAR_MEASURES) {
            List<JsonNode> values = new ArrayList<>();
            for (JsonNode seed : perSeed) values.add(seed.get("routes").get(route).get("measures").get(name));
            out.set(name, summariseSeeds(values));
        }
        TreeSet<String> groups = new TreeSet<>();
        for (JsonNode seed : perSeed) {
            seed.get("routes").get(route).get("measures").get("accessGroupCoverage").fieldNames().forEachRemaining(groups::add);
        }
        ObjectNode coverage = out.putObject("accessGroupCoverage");
        for (String id : groups) {
            List<JsonNode> values = new ArrayList<>();
            for (JsonNode seed : perSeed) values.add(seed.get("routes").get(route).get("measures").get("accessGroupCoverage").get(id));
            coverage.set(id, summariseSeeds(values));
        }
        return out;
    }

    private static JsonNode validRule(JsonNode ruleRow) {
        JsonNode rule = ruleRow == null ? null : ruleRow.get("value");
        boolean good = rule != null && rule.isObject() && numeric(rule.get("schemaVersion"))
                && rule.get("schemaVersion").doubleValue() == 1 && rule.get("rule") != null
                && rule.get("rule").isTextual() && rule.get("rule").textValue().equals("route-seed-ranges-overlap")
                && rule.get("overlapInclusive") != null && rule.get("overlapInclusive").isBoolean()
                && safeInteger(rule.get("minimumSeeds")) && rule.get("minimumSeeds").doubleValue() >= 1
                && rule.get("betterWhen") != null && rule.get("betterWhen").isObject();
        if (good) {
            for (String name : MEASURE_NAMES) {
                JsonNode direction = rule.get("betterWhen").get(name);
                good &= direction != null && direction.isTextual()
                        && (direction.textValue().equals("higher") || direction.textValue().equals("lower"));
            }
        }
        if (!good) throw refuse(RULE_KEY);
        return rule;
    }

    /** One side's value per seed, as the read function names it. */
    private interface Read {
        JsonNode of(JsonNode measures);
    }

    // difference is right minus left, and the wins name the verdict for each side.
    private static ObjectNode entry(String measure, String betterWhen, List<JsonNode[]> pairs, JsonNode rule,
            String[] sides, String[] wins) {
        List<JsonNode> lefts = new ArrayList<>();
        List<JsonNode> rights = new ArrayList<>();
        List<Double> diffs = new ArrayList<>();
        for (JsonNode[] pair : pairs) {
            lefts.add(pair[0]);
            rights.add(pair[1]);
            if (numeric(pair[0]) && numeric(pair[1])) diffs.add(round(pair[1].doubleValue() - pair[0].doubleValue()));
        }
        Summary l = Summary.of(lefts);
        Summary r = Summary.of(rights);
        ObjectNode difference = JSON.objectNode();
        difference.set("mean", l.observed() > 0 && r.observed() > 0 ? num(round(r.mean() - l.mean())) : JSON.nullNode());
        difference.set("min", diffs.isEmpty() ? JSON.nullNode() : num(diffs.stream().reduce(Math::min).get()));
        difference.set("max", diffs.isEmpty() ? JSON.nullNode() : num(diffs.stream().reduce(Math::max).get()));
        String verdict;
        if (diffs.size() < rule.get("minimumSeeds").doubleValue()) {
            verdict = "insufficient-seeds";
        } else {
            boolean inclusive = rule.get("overlapInclusive").booleanValue();
            boolean overlap = inclusive ? l.min() <= r.max() && r.min() <= l.max() : l.min() < r.max() && r.min() < l.max();
            // A shared single point is not a difference even when overlap is exclusive.
            boolean samePoint = l.min().doubleValue() == l.max().doubleValue() && r.min().doubleValue() == r.max().doubleValue()
                    && l.min().doubleValue() == r.min().doubleValue();
            if (overlap || samePoint) {
                verdict = "no-clear-difference";
            } else {
                verdict = (r.min() > l.max()) == betterWhen.equals("higher") ? wins[1] : wins[0];
            }
        }
        ObjectNode out = JSON.objectNode();
        out.put("measure", measure);
        out.put("betterWhen", betterWhen);
        out.set(sides[0], l.toJson());
        out.set(sides[1], r.toJson());
        out.set("difference", difference);
        out.put("verdict", verdict);
        return out;
    }

    private static ArrayNode compareSides(JsonNode perSeed, JsonNode ruleRow, String[] sides, String[] wins) {
        JsonNode rule = validRule(ruleRow);
        if (perSeed == null || !perSeed.isArray()) throw refuse("perSeed");
        TreeSet<String> groups = new TreeSet<>();
        for (JsonNode seed : perSeed) {
            for (String side : sides) {
                JsonNode coverage = seed.path(side).path("accessGroupCoverage");
                if (coverage.isObject()) coverage.fieldNames().forEachRemaining(groups::add);
            }
        }
        ArrayNode out = JSON.arrayNode();
        for (String name : SCALAR_MEASURES) {
            out.add(entry(name, rule.get("betterWhen").get(name).textValue(), pairs(perSeed, sides, m -> m.get(name)), rule, sides, wins));
        }
        for (String id : groups) {
            out.add(entry(GROUP_PREFIX + id, rule.get("betterWhen").get("accessGroupCoverage").textValue(),
                    pairs(perSeed, sides, m -> m.path("accessGroupCoverage").get(id)), rule, sides, wins));
        }
        return out;
    }

    private static List<JsonNode[]> pairs(JsonNode perSeed, String[] sides, Read read) {
        List<JsonNode[]> out = new ArrayList<>();
        for (JsonNode seed : perSeed) {
            out.add(new JsonNode[] { read.of(seed.path(sides[0])), read.of(seed.path(sides[1])) });
        }
        return out;
    }

    /** One honest entry per measure and access group; nothing is dropped, so wins and losses both show. */
    public static ArrayNode compareRoutes(JsonNode perSeed, JsonNode ruleRow) {
        return compareSides(perSeed, ruleRow, new String[] { "current", "buddy" }, new String[] { "current-better", "buddy-better" });
    }

    /** Variant against baseline, paired by seed; the difference is variant minus baseline. */
    public static ArrayNode compareArms(JsonNode perSeed, JsonNode ruleRow) {
        return compareSides(perSeed, ruleRow, new String[] { "baseline", "variant" }, new String[] { "baseline-better", "variant-better" });
    }
}
