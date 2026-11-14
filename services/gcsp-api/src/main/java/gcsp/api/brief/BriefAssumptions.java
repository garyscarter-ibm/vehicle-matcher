package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/** The policy entries the brief rules read, as whole assumption entries ({key, value, status, ...}). */
public record BriefAssumptions(String policyVersion, Map<String, JsonNode> entries) {

    public static final String RECOMMENDATION = "employee.recommendation.v1";
    public static final String SLIDER_MINIMUM = "brief.slider.minimum";
    public static final String SLIDER_MAXIMUM = "brief.slider.maximum";
    public static final String LIFECYCLE = "brief.lifecycle.v1";
    public static final String EDITOR = "brief.editor.v1";
    public static final String ACCOUNT_PREFERENCES = "brief.accountPreferences.v1";
    public static final String ENGAGEMENT = "brief.engagement.v1";
    public static final List<String> KEYS = List.of(RECOMMENDATION, SLIDER_MINIMUM, SLIDER_MAXIMUM, LIFECYCLE, EDITOR,
            ACCOUNT_PREFERENCES, ENGAGEMENT);

    JsonNode entry(String key) {
        return entries.get(key);
    }

    JsonNode payload(String key) {
        JsonNode e = entries.get(key);
        return e == null ? null : e.get("value");
    }
}
