package gcsp.api.allocation;

/** What one reconciliation pass drove; firstPendingId is the first operation still open, or null. */
public record ReconcileResult(int driven, int settled, int pending, int refused, String firstPendingId) {}
