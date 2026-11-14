package gcsp.api.appointments;

/** A policy read: the value, or unavailable (never a default). */
public sealed interface PolicyResult<T> {

    record Ok<T>(T value) implements PolicyResult<T> {}

    record Unavailable<T>(String code, boolean retryable, String reason) implements PolicyResult<T> {}

    String UNAVAILABLE_CODE = "appointment-policy-unavailable";
    String UNAVAILABLE_REASON = "Appointment rules are unavailable. Ask the scheme team to check the scheme setup.";

    static <T> PolicyResult<T> unavailable() {
        return new Unavailable<>(UNAVAILABLE_CODE, true, UNAVAILABLE_REASON);
    }
}
