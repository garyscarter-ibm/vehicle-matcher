package gcsp.api.learning;

import java.util.List;

/** Port of choiceProbabilities in model/optimizer.js: a max-subtracted softmax over the alternatives. */
public final class ChoiceModel {

    private ChoiceModel() {}

    private static boolean finite(double x) {
        return Double.isFinite(x);
    }

    public static double[] probabilities(List<double[]> alternatives, double[] coefficients) {
        ChoiceModelException.require(coefficients != null && coefficients.length > 0 && allFinite(coefficients), "coefficients");
        ChoiceModelException.require(alternatives != null && !alternatives.isEmpty(), "alternatives");
        double[] utilities = new double[alternatives.size()];
        for (int i = 0; i < utilities.length; i++) {
            double[] features = alternatives.get(i);
            ChoiceModelException.require(features != null && features.length == coefficients.length && allFinite(features), "features");
            double utility = 0;
            for (int j = 0; j < features.length; j++) utility += features[j] * coefficients[j];
            ChoiceModelException.require(finite(utility), "utility");
            utilities[i] = utility;
        }
        double maximum = Double.NEGATIVE_INFINITY;
        for (double u : utilities) maximum = Math.max(maximum, u);
        double[] weights = new double[utilities.length];
        double total = 0;
        for (int i = 0; i < weights.length; i++) {
            // StrictMath is fdlibm, the algorithm V8 uses, so exp agrees with Node to the last bit in practice.
            weights[i] = StrictMath.exp(utilities[i] - maximum);
            total += weights[i];
        }
        for (int i = 0; i < weights.length; i++) weights[i] = weights[i] / total;
        return weights;
    }

    private static boolean allFinite(double[] values) {
        for (double v : values) if (!finite(v)) return false;
        return true;
    }
}
