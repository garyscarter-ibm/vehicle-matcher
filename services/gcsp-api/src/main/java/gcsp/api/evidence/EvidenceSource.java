package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** Node's flat registry result (configuration plus vehicle for a VIN) so decorators can wrap it; null images is no list. */
public record EvidenceSource(String status, ActiveInfo active, JsonNode record, JsonNode vehicle,
        JsonNode technicalSupplement, List<JsonNode> images, JsonNode definitionResolution) {

    public static EvidenceSource ofStatus(String status) {
        return new EvidenceSource(status, null, null, null, null, null, null);
    }

    public static EvidenceSource from(CorpusResults.ConfigurationResult result) {
        return new EvidenceSource(result.status(), result.active(), result.record(), null,
                result.technicalSupplement(), result.images(), null);
    }

    public static EvidenceSource from(CorpusResults.VinResult result) {
        CorpusResults.ConfigurationResult configuration = result.configuration();
        if (configuration == null || configuration.record() == null || result.vehicle() == null) {
            return new EvidenceSource(result.status(), result.active(), null, null, null, null, null);
        }
        return new EvidenceSource(result.status(), configuration.active(), configuration.record(), result.vehicle(),
                configuration.technicalSupplement(), configuration.images(), null);
    }
}
