package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Resolves the employee facts and exact stock. Returns the Node provider outcome {status, value | ...}; a thrown
 * exception or a null return counts like the Node provider throwing or returning undefined.
 */
public interface RecommendationSource {

    JsonNode resolve(RecommendationContext context);
}
