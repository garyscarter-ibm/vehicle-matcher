package gcsp.api.account;

/** A pinned instant for automated tests only; AccountSelection refuses it outside test launch mode. */
final class FixedAccountClock implements AccountClockPort {

    private final String now;

    FixedAccountClock(String now) {
        this.now = now;
    }

    @Override
    public ClockReading now(AccountScope scope) {
        return new ClockReading(now, "fixed");
    }
}
