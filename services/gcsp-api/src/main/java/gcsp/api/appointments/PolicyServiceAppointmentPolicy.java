package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.function.Supplier;

/** Appointment assumptions read through the canonical PolicyService and validated by the shared rules; no defaults. */
@ApplicationScoped
public class PolicyServiceAppointmentPolicy implements AppointmentPolicy {

    private final PolicyService policy;

    @Inject
    public PolicyServiceAppointmentPolicy(PolicyService policy) {
        this.policy = policy;
    }

    @Override
    public PolicyResult<AppointmentConfig> config(String runId, String policyVersion, Instant asOf) {
        return read(runId, policyVersion, asOf, () -> AppointmentRules.config(policyVersion, rows(runId, policyVersion, asOf)));
    }

    @Override
    public PolicyResult<OutcomeTiming> timing(String runId, String policyVersion, Instant asOf) {
        return read(runId, policyVersion, asOf, () -> AppointmentRules.timing(policyVersion, rows(runId, policyVersion, asOf)));
    }

    private static <T> PolicyResult<T> read(String runId, String policyVersion, Instant asOf, Supplier<PolicyResult<T>> rules) {
        if (!Values.id(runId, 200) || !Values.id(policyVersion, 200) || asOf == null) return PolicyResult.unavailable();
        try {
            return rules.get();
        } catch (RuntimeException e) {
            return PolicyResult.unavailable();
        }
    }

    private AppointmentRules.Rows rows(String runId, String policyVersion, Instant asOf) {
        PolicyRead read = new PolicyRead(runId, PolicyClock.iso(asOf), policyVersion);
        return key -> {
            gcsp.api.policy.PolicyResult found = policy.getAssumption(key, read);
            JsonNode row = found.value();
            return found.ok() && row != null && row.isObject() ? row : null;
        };
    }
}
