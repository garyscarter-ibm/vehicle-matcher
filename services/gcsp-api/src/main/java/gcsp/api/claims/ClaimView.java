package gcsp.api.claims;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** The facts of one manual claim that ordering needs (see ManualClaims.claimForOrdering). */
public record ClaimView(String holdId, String orderUuid, String employeeId, String slotId, String state, String phase,
        Instant expiresAt, long holdVersion, String mode, String termsDigest, Instant validUntil, JsonNode quote) {}
