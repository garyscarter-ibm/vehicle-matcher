package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** One provider shape behind the application contract; the consumer validates everything it returns. */
public interface VehicleProvider {

    /** protocol is "in-process" or "offline"; status is the transport status or null; outcome is "answered" or "unavailable". */
    record Transport(String protocol, Integer status, int attempts, String outcome) {}

    /** result is any JSON value (or null) the provider produced; only the consumer decides whether it is usable. */
    record ProviderResponse(Transport transport, JsonNode result) {}

    ProviderResponse resolve(EvidenceRequest trusted, EvidenceContext context);
}
