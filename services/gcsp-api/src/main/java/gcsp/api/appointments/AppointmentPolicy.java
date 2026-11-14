package gcsp.api.appointments;

import java.time.Instant;

/** Appointment assumptions by key at a pinned policy version and instant. No consumer defaults exist. */
public interface AppointmentPolicy {

    PolicyResult<AppointmentConfig> config(String policyVersion, Instant asOf);

    PolicyResult<OutcomeTiming> timing(String policyVersion, Instant asOf);
}
