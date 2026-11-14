package gcsp.api.returns;

/** What applying a confirmed event did, or why it was refused (nothing was written for a refusal). */
public sealed interface CurrentCarResult {

    /** applied is false for a repeat of an event already recorded with the same input. */
    record Applied(boolean applied, CurrentCarView relationship) implements CurrentCarResult {}

    /** The caller's work should return WorkResult.refuse(code, message) so its transaction rolls back. */
    record Refused(String code, String message) implements CurrentCarResult {}
}
