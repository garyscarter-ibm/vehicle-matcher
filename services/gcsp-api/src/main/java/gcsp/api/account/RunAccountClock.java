package gcsp.api.account;

import gcsp.api.clock.RunClockHolder;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** Account time and version come from the caller's persisted run, read afresh on every request. */
public final class RunAccountClock implements AccountClockPort {

    private static final DateTimeFormatter ISO_MILLIS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final RunClockHolder holder;

    public RunAccountClock(RunClockHolder holder) {
        this.holder = holder;
    }

    @Override
    public ClockReading now(AccountScope scope) {
        var reading = holder.clock().now(scope.environmentId(), scope.runId())
                .orElseThrow(() -> new ClockUnavailableException("The account's run clock is unavailable."));
        return new ClockReading(ISO_MILLIS.format(reading.now()), Long.toString(reading.clockVersion()));
    }
}
