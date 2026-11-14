package gcsp.api.notify;

/** The stable identity of one delivery attempt, for a transport's own idempotency (event plus attempt number). */
public record DeliveryAttempt(String eventId, int attempts, String recipientEmployeeId) {}
