package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;

/** The injected time port: {status:'ok', value:{now, runId, clockVersion}} or a stale-run outcome. */
public interface RecommendationClock {

    JsonNode now(RecommendationContext context);
}
