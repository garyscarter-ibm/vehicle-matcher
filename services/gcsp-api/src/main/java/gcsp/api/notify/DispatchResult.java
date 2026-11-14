package gcsp.api.notify;

/** What one drain did: counts of attempts finished, or why it could not run. */
public sealed interface DispatchResult {

    record Counts(int sent, int retrying, int failed) implements DispatchResult {}

    /** Rules, the run or the database were not available; nothing further was claimed. */
    record Unavailable() implements DispatchResult {}

    /** The run was retired mid-drain; old-run rows gain no new state. */
    record StaleRun() implements DispatchResult {}
}
