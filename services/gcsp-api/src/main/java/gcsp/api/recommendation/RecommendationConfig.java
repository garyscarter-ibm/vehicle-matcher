package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/** The employee.recommendation.v1 assumption value, handed in by the caller; never read from the seed here. */
public record RecommendationConfig(JsonNode json) {

    private static final List<String> LISTS = List.of("confirmedAssurances", "plugInFuels", "chargingAccess", "availabilityStates");

    /** Port of configurationValid: brief schema v1 fixes the slider scale, conflicting policy fails closed. */
    public boolean valid(Slider slider) {
        JsonNode c = json == null || json.isNull() ? null : json;
        if (c == null || !Js.isBool(c.get("driverEligibilityRequired"))) return false;
        if (!(c.get("retailBudgetEnabled") != null && c.get("retailBudgetEnabled").isBoolean() && !c.get("retailBudgetEnabled").booleanValue())) return false;
        if (!Js.safeInt(c.get("displayLimit")) || c.get("displayLimit").doubleValue() <= 0) return false;
        if (!Js.finite(c.get("termValiditySeconds")) || c.get("termValiditySeconds").doubleValue() <= 0) return false;
        for (String key : LISTS) {
            JsonNode list = c.get(key);
            if (list == null || !list.isArray()) return false;
            for (JsonNode item : list) if (!Js.text(item)) return false;
        }
        if (!Js.truthy(c.get("preferences")) || !Js.truthy(c.get("essentials"))) return false;
        JsonNode tuning = c.get("tuning");
        if (Js.nullish(tuning) || !Js.truthy(Js.get(tuning, "weights")) || !Js.truthy(Js.get(tuning, "hardFilter"))) return false;
        return Double.isFinite(slider.minimum()) && Double.isFinite(slider.maximum())
                && slider.minimum() == 0 && slider.maximum() == 100;
    }

    /** Only meaningful once valid(slider) holds. */
    public int displayLimit() {
        return json.get("displayLimit").intValue();
    }

    public double termValiditySeconds() {
        return json.get("termValiditySeconds").doubleValue();
    }

    public boolean driverEligibilityRequired() {
        return json.get("driverEligibilityRequired").booleanValue();
    }

    public List<String> availabilityStates() {
        List<String> out = new ArrayList<>();
        json.get("availabilityStates").forEach(s -> out.add(s.textValue()));
        return out;
    }

    JsonNode read(String key) {
        return Js.get(json, key);
    }
}
