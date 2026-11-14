package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** Result shapes returned by CorpusStore reads; record payloads are fresh Jackson trees. */
public final class CorpusResults {

    private CorpusResults() {}

    /** Store status: "ok" when a validated corpus is selected, otherwise "source-unavailable". */
    public record Status(String status, ActiveInfo active) {}

    /** status is the catalogue status, "not-found", "invalid-input" or "source-unavailable" (see failure). */
    public record ConfigurationResult(String status, CorpusFailure failure, ActiveInfo active, String sourceKind,
            JsonNode record, JsonNode technicalSupplement, List<JsonNode> images, String imageState) {}

    /** VIN read by vin17 or vin7. configuration is set only when the VIN and its configuration resolved. */
    public record VinResult(String status, CorpusFailure failure, String identityKind, boolean liveEligible,
            ActiveInfo active, JsonNode vehicle, ConfigurationResult configuration, String notice) {}

    /** History classification; identityKind is "synthetic" or "unknown" and liveEligible is always false. */
    public record Classification(String status, CorpusFailure failure, String identityKind, boolean liveEligible,
            String vehicleId, String configurationId, String originatingDatasetId) {}
}
