package gcsp.api.allocation;

import java.time.Instant;

/** What a tick supplies to one allocation: the run, its policy version and the tick's instant and clock version. */
public record AllocationScope(String environmentId, String runId, String policyVersion, Instant now,
        long clockVersion) {

    /** A message when the scope cannot be used, else null. */
    String problem() {
        if (blank(environmentId) || blank(runId) || blank(policyVersion) || now == null || clockVersion <= 0) {
            return "The allocation scope needs an environment, run, policy version, instant and clock version.";
        }
        return null;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
