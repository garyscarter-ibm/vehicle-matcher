package gcsp.api.account;

public interface AccountClockPort {

    /** now is an ISO instant with millis and Z, such as 2026-11-05T09:00:00.000Z. */
    record ClockReading(String now, String clockVersion) {}

    /** Throws {@link ClockUnavailableException} when no trusted time is available. */
    ClockReading now(AccountScope scope);
}
