package gcsp.api.learning;

import java.util.ArrayList;
import java.util.List;

/** The pure narrowing rules of createLearnedOrderForecastProvider (forecast/plan-forecast.js), for the planner story. */
public final class LearnedNarrowing {

    /** One permitted vehicle and its modelled probability. */
    public record Choice(String derivativeId, double probability) {}

    private LearnedNarrowing() {}

    /** Smallest set of choices, likeliest first, whose share of the non-wait mass reaches the threshold; sorted by id. */
    public static List<String> likeliest(List<Choice> choices, double threshold) {
        List<Choice> ranked = new ArrayList<>(choices);
        ranked.sort((a, b) -> {
            double difference = b.probability() - a.probability();
            return difference != 0 ? (difference < 0 ? -1 : 1) : a.derivativeId().compareTo(b.derivativeId());
        });
        double mass = 0;
        for (Choice c : ranked) mass += c.probability();
        List<String> kept = new ArrayList<>();
        double cumulative = 0;
        for (Choice c : ranked) {
            if (!kept.isEmpty() && cumulative >= threshold * mass - 1e-12) break;
            kept.add(c.derivativeId());
            cumulative += c.probability();
        }
        kept.sort(String::compareTo);
        return kept;
    }

    /** True when the model expects this employee to wait, so the learned plan leaves them out. */
    public static boolean expectsWait(double waitProbability, double waitExclusionThreshold) {
        return waitProbability > waitExclusionThreshold;
    }
}
