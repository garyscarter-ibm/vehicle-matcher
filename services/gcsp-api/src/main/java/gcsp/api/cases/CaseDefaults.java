package gcsp.api.cases;

import java.util.List;

/** Fallback adapters for deployments that lack the real source. */
public final class CaseDefaults {

    private CaseDefaults() {}

    /** Used without persistence or an account provider: no car can be checked, so none can be proposed. */
    public static class NoSuitability implements CaseCarSuitabilityPort {
        @Override
        public Options options(String environmentId, String runId, String employeeId, String policyVersion) {
            return new Options(false, List.of(), List.of());
        }

        @Override
        public Check check(String environmentId, String runId, String employeeId, String policyVersion,
                String orderUuid) {
            return new Check(Verdict.UNAVAILABLE, null);
        }
    }
}
