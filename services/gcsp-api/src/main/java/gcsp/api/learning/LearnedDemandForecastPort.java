package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;

/** The learned demand forecast the order planner injects; there is no route of its own, as in Node. */
public interface LearnedDemandForecastPort {

    /**
     * Scores a PredictionInput (contract 1.0.0). Returns a body with status ok, fallback, invalid or unavailable,
     * shaped as the Node provider's. A null read is taken from the input's run, instant and policy version.
     */
    ObjectNode forecast(JsonNode predictionInput, PolicyRead read);
}
