package gcsp.api.cases;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

/** Production defaults until the real adapters exist; each is replaced by providing another bean. */
public final class CaseDefaults {

    private CaseDefaults() {}

    /** No Java recommendation or suitability service exists yet, so no car can be proposed. */
    @DefaultBean
    @ApplicationScoped
    public static class NoSuitability implements CaseCarSuitabilityPort {
        @Override
        public Options options(String environmentId, String runId, String employeeId) {
            return new Options(false, List.of(), List.of());
        }

        @Override
        public Check check(String environmentId, String runId, String employeeId, String orderUuid) {
            return new Check(Verdict.UNAVAILABLE, null);
        }
    }
}
