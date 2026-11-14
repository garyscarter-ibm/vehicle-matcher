package gcsp.api.allocation;

import java.util.List;

/** The typed answer of one local Buddy expiry tick. */
public sealed interface ExpiryResult {

    /** One hold that lapsed at this tick. */
    record Lapse(String holdId, String offerId, String orderUuid, String employeeId, String expiresAt, String expiredAt) {}

    /** One due hold left unchanged, with why (its owner reconciles it). */
    record Retained(String holdId, String reason) {}

    /** The tick ran. Replayed means this tick had already committed. */
    record Done(List<Lapse> expired, List<Retained> retained, boolean replayed) implements ExpiryResult {}

    /** An outcome was uncertain or the database was unavailable; running the same tick again resumes it. */
    record Pending(String code, boolean retryable) implements ExpiryResult {}

    /** The scope or policy cannot be used; nothing was written. */
    record Refused(String code, String message) implements ExpiryResult {}
}
