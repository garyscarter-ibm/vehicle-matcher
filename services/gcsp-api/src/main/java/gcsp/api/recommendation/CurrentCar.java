package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** The current-car feedback rules of server/gcsp/recommendation/current-car.js and the stored rating and same-again shapes. */
final class CurrentCar {

    static final String FEEDBACK_KEY = "employee.currentCarFeedback.v1";
    private static final List<String> PRECEDENCE = List.of("gates", "sameAgain", "rating", "preferences");
    private static final List<String> RATING_FIELDS = List.of("value", "contractId", "source", "ratedAt");
    private static final List<String> SAME_AGAIN_FIELDS = List.of("on", "contractId", "source", "setAt");
    private static final Pattern BASE64 = Pattern.compile("[A-Za-z0-9+/]+={0,2}");
    private static final Pattern CODES = Pattern.compile("[A-Z0-9]{2,16}:[A-Z0-9]{2,16}(?:,[A-Z0-9]{2,16})*");

    private CurrentCar() {}

    static boolean plain(JsonNode v) {
        return v != null && v.isObject();
    }

    /** text(): non-blank and at most 256 characters. */
    static boolean text(JsonNode v) {
        return Js.text(v) && v.textValue().length() <= 256;
    }

    /** The provider baseline is trusted only in this shape; anything else is no baseline (null). */
    static JsonNode baselineOf(JsonNode value) {
        if (!plain(value) || !text(value.get("contractId")) || !plain(value.get("source"))
                || !text(value.get("source").get("sourceVersion")) || !plain(value.get("facts"))) return null;
        return value;
    }

    private static boolean names(JsonNode list) {
        if (list == null || !list.isArray() || list.size() == 0) return false;
        Set<String> seen = new HashSet<>();
        for (JsonNode n : list) if (!n.isTextual() || !seen.add(n.textValue())) return false;
        for (JsonNode n : list) if (!text(n)) return false;
        return true;
    }

    private static boolean scale(JsonNode list) {
        if (list == null || !list.isArray()) return false;
        for (JsonNode n : list) if (!Js.isInteger(n) || n.doubleValue() < 1 || n.doubleValue() > 5) return false;
        return true;
    }

    static boolean policyValid(JsonNode v) {
        if (!plain(v) || !Js.strictEq(v.get("schemaVersion"), Js.F.numberNode(1)) || !plain(v.get("rating"))) return false;
        JsonNode rating = v.get("rating");
        Set<Double> all = new HashSet<>();
        int total = 0;
        for (String k : List.of("positive", "negative", "neutral")) {
            if (!scale(rating.get(k))) return false;
            for (JsonNode n : rating.get(k)) {
                all.add(n.doubleValue());
                total++;
            }
        }
        if (all.size() != total) return false;
        if (!plain(v.get("similarity")) || !names(v.get("similarity").get("dimensions"))) return false;
        if (!plain(v.get("sameAgain")) || !names(v.get("sameAgain").get("dimensions"))) return false;
        JsonNode improvement = v.get("improvement");
        if (!plain(improvement) || !Js.isBool(improvement.get("requireNoWorseOnAll"))) return false;
        JsonNode better = improvement.get("requireBetterOnAtLeast");
        if (!Js.safeInt(better) || better.doubleValue() < 1) return false;
        JsonNode precedence = v.get("precedence");
        if (precedence == null || !precedence.isArray() || precedence.size() != PRECEDENCE.size()) return false;
        for (int i = 0; i < PRECEDENCE.size(); i++) if (!Js.eqStr(precedence.get(i), PRECEDENCE.get(i))) return false;
        return true;
    }

    /** ratingClass(value, rating): positive, negative or neutral. */
    static String ratingClass(JsonNode value, JsonNode rating) {
        for (String k : List.of("positive", "negative")) if (Js.includes(Js.get(rating, k), value)) return k;
        return "neutral";
    }

    /** The stored current-car star rating shape: an integer 1 to 5 or null. */
    static boolean ratingValid(JsonNode r) {
        if (!hasExactly(r, RATING_FIELDS)) return false;
        JsonNode value = r.get("value");
        JsonNode contract = r.get("contractId");
        return (value.isNull() || Js.safeInt(value) && value.doubleValue() >= 1 && value.doubleValue() <= 5)
                && idValid(contract) && Js.eqStr(r.get("source"), "employee") && Js.validInstant(r.get("ratedAt"));
    }

    static boolean sameAgainValid(JsonNode s) {
        if (!hasExactly(s, SAME_AGAIN_FIELDS)) return false;
        return Js.isBool(s.get("on")) && idValid(s.get("contractId")) && Js.eqStr(s.get("source"), "employee")
                && Js.validInstant(s.get("setAt"));
    }

    private static boolean idValid(JsonNode id) {
        return id != null && id.isTextual() && Js.text(id) && id.textValue().length() <= 128;
    }

    private static boolean hasExactly(JsonNode r, List<String> fields) {
        if (!plain(r)) return false;
        if (!Js.only(r, fields)) return false;
        for (String f : fields) if (!r.has(f)) return false;
        return true;
    }

    /** canonicalVehicleIdentifier('configuration', id): the id when it is a canonical base64 configuration, else null. */
    static String canonicalConfiguration(JsonNode node) {
        if (node == null || !node.isTextual()) return null;
        String id = node.textValue();
        if (id.length() > 8192 || id.length() % 4 != 0 || !BASE64.matcher(id).matches()) return null;
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(id);
        } catch (IllegalArgumentException e) {
            return null;
        }
        String decoded = new String(raw, StandardCharsets.UTF_8);
        if (!Base64.getEncoder().encodeToString(decoded.getBytes(StandardCharsets.UTF_8)).equals(id)
                || !CODES.matcher(decoded).matches()) return null;
        int colon = decoded.indexOf(':');
        String[] codes = decoded.substring(colon + 1).split(",", -1);
        if (codes.length > 256 || new HashSet<>(Arrays.asList(codes)).size() != codes.length) return null;
        String[] sorted = codes.clone();
        Arrays.sort(sorted);
        return (decoded.substring(0, colon) + ":" + String.join(",", sorted)).equals(decoded) ? id : null;
    }

    /** similar or same only when every dimension is confirmed equal on both sides; one confirmed difference is different. */
    static String matchDimensions(JsonNode baselineFacts, JsonNode facts, JsonNode dimensions, RecommendationConfig config,
            String equal, JsonNode configurationId) {
        boolean unknown = false;
        for (JsonNode dimension : Js.array(dimensions)) {
            String key = Js.key(dimension);
            JsonNode a = Js.prop(baselineFacts, key);
            JsonNode b = Js.prop(facts, key);
            if (key.equals("configurationId")) {
                if (!Gates.confirmedFact(a, config) || canonicalConfiguration(a.get("value")) == null
                        || canonicalConfiguration(configurationId) == null) {
                    unknown = true;
                    continue;
                }
                if (!Js.strictEq(a.get("value"), configurationId)) return "different";
                continue;
            }
            if (!Gates.confirmedFact(a, config) || !Gates.confirmedFact(b, config)) {
                unknown = true;
                continue;
            }
            if (!Js.strictEq(a.get("value"), b.get("value"))) return "different";
        }
        return unknown ? "unknown" : equal;
    }

    /** {result, keys}: proven, not-proven or unknown from the confirmed expressed preferences only. */
    static ObjectNode compareImprovement(JsonNode snapshot, JsonNode scored, JsonNode baseline, JsonNode brief,
            JsonNode employeeFacts, RecommendationConfig config, Slider slider, JsonNode rule) {
        ArrayNode expressed = Js.arr();
        for (Map.Entry<String, JsonNode> e : Js.entries(Js.get(brief, "preferences"))) {
            JsonNode p = e.getValue();
            if (Js.rel(Js.get(p, "importance"), slider.minimum()) > 0 && Js.eqStr(p.get("valueState"), "confirmed")
                    && Js.eqStr(p.get("importanceState"), "confirmed")) expressed.add(Js.F.textNode(e.getKey()));
        }
        if (expressed.size() == 0) return outcome("not-proven", Js.arr());
        ObjectNode facts = Js.obj();
        for (Map.Entry<String, JsonNode> e : Js.entries(Js.get(baseline, "facts"))) {
            if (Gates.confirmedFact(e.getValue(), config)) facts.set(e.getKey(), e.getValue());
        }
        ObjectNode car = new Js.B().s("display", new Js.B().s("name", "current car").build()).s("facts", facts).build();
        JsonNode base = PreferenceScoring.score(car, brief, employeeFacts, config, slider).get("components");
        List<JsonNode> cs = new java.util.ArrayList<>();
        List<JsonNode> bs = new java.util.ArrayList<>();
        for (JsonNode key : expressed) {
            cs.add(at(Js.get(scored, "components"), key.textValue(), config));
            bs.add(at(base, key.textValue(), config));
        }
        for (int i = 0; i < cs.size(); i++) if (!Js.finite(cs.get(i)) || !Js.finite(bs.get(i))) return outcome("unknown", Js.arr());
        ArrayNode better = Js.arr();
        boolean worse = false;
        for (int i = 0; i < cs.size(); i++) {
            double c = cs.get(i).doubleValue();
            double b = bs.get(i).doubleValue();
            if (c > b) better.add(expressed.get(i));
            if (c < b) worse = true;
        }
        boolean noWorse = !Js.truthy(Js.get(rule, "requireNoWorseOnAll")) || !worse;
        boolean enough = Js.rel(Js.F.numberNode(better.size()), Js.get(rule, "requireBetterOnAtLeast")) >= 0;
        return outcome(noWorse && enough ? "proven" : "not-proven", better);
    }

    /** An anchored score for a missing model fact is not evidence, so it stays unknown (undefined). */
    private static JsonNode at(JsonNode rows, String key, RecommendationConfig config) {
        JsonNode row = null;
        for (JsonNode r : Js.array(rows)) {
            if (Js.eqStr(Js.get(r, "field"), key)) {
                row = r;
                break;
            }
        }
        if (row == null) return null;
        if (Js.truthy(row.get("modelFactsIncomplete"))) return null;
        JsonNode facts = row.get("facts");
        if (!Js.nullish(facts)) for (Map.Entry<String, JsonNode> e : Js.entries(facts)) if (!Gates.confirmedFact(e.getValue(), config)) return null;
        return row.get("score");
    }

    private static ObjectNode outcome(String result, ArrayNode keys) {
        return new Js.B().s("result", result).s("keys", keys).build();
    }
}
