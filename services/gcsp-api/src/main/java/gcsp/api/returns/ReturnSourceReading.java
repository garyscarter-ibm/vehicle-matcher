package gcsp.api.returns;

/** The answer of the selection record read: found, absent, unusable (not retryable) or unavailable. */
public sealed interface ReturnSourceReading {

    record Found(ReturnSource source) implements ReturnSourceReading {}

    record NotFound() implements ReturnSourceReading {}

    record Invalid(String code, boolean retryable, String reason) implements ReturnSourceReading {}

    record Unavailable(String code, boolean retryable, String reason) implements ReturnSourceReading {}

    static Invalid invalid() {
        return new Invalid(ReturnSource.INVALID, false, "The record of your current car could not be read.");
    }
}
