package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** Reads one offline card; implementations must not open a network connection. */
@FunctionalInterface
public interface OfflineCardReader {

    /** document is a JSON object or a string holding JSON text; transportStatus null means no transport status. */
    record OfflineResponse(Integer transportStatus, JsonNode document) {}

    /** category is composition, order or delivered; any exception fails the attempt. */
    OfflineResponse read(String category, String token, EvidenceContext context) throws Exception;
}
