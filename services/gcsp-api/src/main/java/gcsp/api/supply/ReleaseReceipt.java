package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** The immutable tranche receipt: what one tick released. */
public record ReleaseReceipt(String trancheId, String windowId, String supplyId, String tickId, Instant releasedAt,
        String policyVersion, JsonNode source, JsonNode orderUuids, JsonNode visibleOrderUuids, JsonNode outcome) {}
