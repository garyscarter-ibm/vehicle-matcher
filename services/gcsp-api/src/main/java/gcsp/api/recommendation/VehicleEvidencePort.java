package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import java.util.Optional;

/**
 * The validated exact-stock snapshot of one released car. FUCQ-459 replaces {@link StockFactsEvidence}; releasedFacts
 * is the row's own stored facts, so no implementation needs a per-car read. Empty means no evidence, never a fabrication.
 */
public interface VehicleEvidencePort {

    Optional<JsonNode> snapshot(RunContext scope, String orderUuid, String configurationId, JsonNode releasedFacts);
}
