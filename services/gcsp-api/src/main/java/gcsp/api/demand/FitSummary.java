package gcsp.api.demand;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Node evaluateFit's published summary: cohort counts banded under the privacy threshold, never a single score. */
public final class FitSummary {

    private FitSummary() {}

    /** employeesWithEligibleStock and the finite best score of each scoring employee, in brief order. */
    public static ObjectNode render(int eligible, List<Double> bestScores, int threshold) {
        ObjectNode out = Demand.obj();
        out.put("basis", "saved-brief-recommendation-fit");
        out.put("label", "Recommendation fit, not predicted acceptance");
        out.set("employeesWithEligibleStock", count(eligible, threshold));
        out.set("scoredBriefs", count(bestScores.size(), threshold));
        ObjectNode mean = out.putObject("meanBestScore");
        if (bestScores.size() >= threshold) {
            double sum = 0;
            for (double score : bestScores) sum += score;
            mean.put("status", "available").put("value", sum / bestScores.size()).put("unit", "score/100");
        } else {
            mean.put("status", "suppressed").put("fewerThan", threshold).put("unit", "score/100");
        }
        return out;
    }

    private static ObjectNode count(int value, int threshold) {
        ObjectNode n = Demand.obj();
        if (value < threshold) {
            n.put("kind", "band").put("fewerThan", threshold).put("label", "fewer than " + threshold);
        } else {
            n.put("kind", "exact").put("value", value).put("label", String.valueOf(value));
        }
        return n;
    }
}
