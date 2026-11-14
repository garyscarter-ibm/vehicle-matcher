package gcsp.api.appointments;

/** Earliest demo time an outcome may be recorded, in seconds after the booked slot start (Node loadOutcomeTiming). */
public record OutcomeTiming(int completeAfterSlotStartSeconds, int noShowAfterSlotStartSeconds,
        AppointmentConfig.Step tooEarly) {}
