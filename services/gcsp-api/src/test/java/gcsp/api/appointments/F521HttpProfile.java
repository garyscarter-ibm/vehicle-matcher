package gcsp.api.appointments;

import java.util.Set;

/** Native PostgreSQL and real signed test JWTs, with the existing HTTP stage/readiness fixtures. */
public class F521HttpProfile extends ApptHttpProfiles {
    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of(ApptHttpPorts.Stages.class, ApptHttpPorts.Readiness.class, F521AppointmentsWiring.class);
    }
}
