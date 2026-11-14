package gcsp.api.cases;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;

/** Test port adapters, enabled only by the case HTTP profiles: one known renewal (policy is the canonical PolicyService). */
public final class CaseHttpPorts {

    private CaseHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class KnownRenewal implements CaseAccountPort {
        @Override
        public Lookup renewal(String environmentId, String runId, String employeeId) {
            return Lookup.ok("Paula Example", "renewal:" + employeeId, "2026-12-01");
        }
    }
}
