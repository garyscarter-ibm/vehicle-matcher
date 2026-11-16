package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/** Employee recommendation ordering, ported from rankEmployeeRecommendations in server/scenarios/employee/index.js. */
public final class Ranking {

    private Ranking() {}

    /** Eligible entries in order; a band is anchored to its best remaining fit so near-tie chains
     * cannot promote a much worse match. Entries carry gateStatus, score, orderUuid, terms.points.value. */
    public static List<JsonNode> rank(List<? extends JsonNode> decisions, RecommendationConfig config) {
        List<JsonNode> ranked = new ArrayList<>();
        for (JsonNode d : decisions) if (Js.eqStr(Js.get(d, "gateStatus"), "eligible")) ranked.add(d);
        ranked.sort(Ranking::byScore);
        JsonNode ranking = config.read("ranking");
        if (ranking == null) return ranked; // Retain the ordering of older policy pins.
        JsonNode tolerance = Js.get(ranking, "fitTolerance");
        if (!Js.eqStr(Js.get(ranking, "rule"), "similarFitThenPoints") || !Js.finite(tolerance)
                || tolerance.doubleValue() < 0 || tolerance.doubleValue() > 100) {
            throw new RecommendationFault("Invalid employee recommendation ranking");
        }
        double fitTolerance = tolerance.doubleValue();
        List<JsonNode> ordered = new ArrayList<>();
        for (int start = 0; start < ranked.size();) {
            JsonNode best = Js.get(ranked.get(start), "score");
            int end = start + 1;
            while (end < ranked.size() && sameBand(best, Js.get(ranked.get(end), "score"), fitTolerance)) end++;
            List<JsonNode> band = new ArrayList<>(ranked.subList(start, end));
            band.sort(Ranking::byPoints);
            ordered.addAll(band);
            start = end;
        }
        return ordered;
    }

    private static boolean isNull(JsonNode n) {
        return n != null && n.isNull();
    }

    private static boolean sameBand(JsonNode best, JsonNode next, double tolerance) {
        if (isNull(best)) return isNull(next);
        return !isNull(next) && Js.toNumber(best) - Js.toNumber(next) <= tolerance;
    }

    /** `(score ?? -1)` as a number. */
    private static double scoreOf(JsonNode d) {
        JsonNode s = Js.get(d, "score");
        return Js.nullish(s) ? -1 : Js.toNumber(s);
    }

    private static int bySign(double x) {
        return x < 0 ? -1 : 1;
    }

    private static int byScore(JsonNode a, JsonNode b) {
        double diff = scoreOf(b) - scoreOf(a);
        return Js.truthy(diff) ? bySign(diff) : uuid(a, b);
    }

    private static int byPoints(JsonNode a, JsonNode b) {
        double points = Js.toNumber(Js.at(b, "terms", "points", "value")) - Js.toNumber(Js.at(a, "terms", "points", "value"));
        if (Js.truthy(points)) return bySign(points);
        double fit = scoreOf(b) - scoreOf(a);
        return Js.truthy(fit) ? bySign(fit) : uuid(a, b);
    }

    private static int uuid(JsonNode a, JsonNode b) {
        JsonNode left = Js.get(a, "orderUuid");
        if (left == null || !left.isTextual()) throw new RecommendationFault("orderUuid.localeCompare is not a function");
        return Locale.compare(left.textValue(), Js.toStr(Js.get(b, "orderUuid")));
    }

    /** localeCompare for ASCII ids (case-folded, then lowercase first); equals compareTo for lowercase hex UUIDs. */
    static final class Locale {

        private Locale() {}

        static int compare(String a, String b) {
            if (!plain(a) || !plain(b)) return Integer.signum(a.compareTo(b));
            int n = Math.min(a.length(), b.length());
            for (int i = 0; i < n; i++) {
                int c = Character.toLowerCase(a.charAt(i)) - Character.toLowerCase(b.charAt(i));
                if (c != 0) return c < 0 ? -1 : 1;
            }
            if (a.length() != b.length()) return a.length() < b.length() ? -1 : 1;
            for (int i = 0; i < n; i++) {
                char x = a.charAt(i);
                char y = b.charAt(i);
                if (x != y) return Character.isLowerCase(x) ? -1 : 1;
            }
            return 0;
        }

        private static boolean plain(String s) {
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '-')) return false;
            }
            return true;
        }
    }
}
