package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;

/** The brief slider scale from the brief.slider.minimum and brief.slider.maximum assumptions. */
public record Slider(double minimum, double maximum) {

    /** Reads {minimum, maximum}; anything that is not a JSON number becomes NaN (JS undefined). */
    public static Slider from(JsonNode node) {
        return new Slider(number(node, "minimum"), number(node, "maximum"));
    }

    private static double number(JsonNode node, String key) {
        JsonNode value = node == null ? null : node.get(key);
        return value != null && value.isNumber() ? value.doubleValue() : Double.NaN;
    }
}
