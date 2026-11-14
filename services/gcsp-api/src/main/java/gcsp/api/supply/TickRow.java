package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** A delivered tick as stored: state is pending, completed or refused; lastOutcome is the latest answer. */
public record TickRow(String tickId, Instant now, long clockVersion, String inputDigest, String state, int attempts,
        long version, long deliveredSeq, JsonNode lastOutcome) {}
