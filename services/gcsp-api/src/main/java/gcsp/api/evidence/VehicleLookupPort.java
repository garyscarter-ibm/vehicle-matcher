package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** The same-process lookup the application adapter calls; the result is any JSON value and is validated downstream. */
public interface VehicleLookupPort {

    JsonNode resolve(EvidenceRequest request, EvidenceContext context);
}
