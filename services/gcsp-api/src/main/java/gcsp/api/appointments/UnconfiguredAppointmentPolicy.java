package gcsp.api.appointments;

import java.time.Instant;

/** No policy source is wired: every read is unavailable, so no rule is ever assumed. */
public final class UnconfiguredAppointmentPolicy implements AppointmentPolicy {

    @Override
    public PolicyResult<AppointmentConfig> config(String policyVersion, Instant asOf) {
        return PolicyResult.unavailable();
    }

    @Override
    public PolicyResult<OutcomeTiming> timing(String policyVersion, Instant asOf) {
        return PolicyResult.unavailable();
    }
}
