package gcsp.api.returns;

/** The answer of the handover read: the new car's appointment, absent, or unavailable. */
public sealed interface HandoverReading {

    /** state is the handover appointment state; slot and providerReference are null until one is booked. */
    record Found(String state, AppointmentSlot slot, String providerReference) implements HandoverReading {}

    record NotFound() implements HandoverReading {}

    record Unavailable(String code, boolean retryable, String reason) implements HandoverReading {}
}
