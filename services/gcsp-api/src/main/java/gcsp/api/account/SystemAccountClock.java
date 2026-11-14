package gcsp.api.account;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

public final class SystemAccountClock implements AccountClockPort {

    private static final DateTimeFormatter ISO_MILLIS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    @Override
    public ClockReading now(AccountScope scope) {
        return new ClockReading(ISO_MILLIS.format(Instant.now().truncatedTo(ChronoUnit.MILLIS)), "system");
    }
}
