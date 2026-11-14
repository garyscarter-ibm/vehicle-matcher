package gcsp.api.supply;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** A durable clock tick from the tick source; now is held to milliseconds like every stored instant. */
public record TickEvent(String tickId, Instant now, long clockVersion) {

    public TickEvent {
        if (now != null) now = now.truncatedTo(ChronoUnit.MILLIS);
    }

    boolean valid() {
        return tickId != null && !tickId.isEmpty() && tickId.length() <= 200 && now != null && clockVersion > 0;
    }
}
