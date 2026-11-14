package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** No tick source is wired: there is no appointment time, and the wall clock is never used instead. */
public final class UnconfiguredAppointmentClock implements AppointmentClock {

    @Override
    public Optional<Instant> now(RunContext context) {
        return Optional.empty();
    }
}
