package gcsp.api.clock;

import java.time.Instant;

/** The active run's clock at one read. */
public record ClockReading(Instant now, long clockVersion) {}
