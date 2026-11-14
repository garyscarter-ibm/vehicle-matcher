package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** The run's appointment demo time. Never the wall clock; empty means no tick has set it yet. */
public interface AppointmentClock {

    Optional<Instant> now(RunContext context);
}
