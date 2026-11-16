package gcsp.api.recommendation;

import java.util.List;

/** The server-resolved employee context of one evaluation; entitlementSlotId is optional (null when absent). */
public record RecommendationContext(String runId, String environmentId, String employeeId, String companyId,
        String schemeId, String gradeId, String policyVersion, List<String> roles, String entitlementSlotId) {

    public RecommendationContext {
        roles = roles == null ? List.of() : List.copyOf(roles);
    }

    public RecommendationContext(String runId, String environmentId, String employeeId, String companyId,
            String schemeId, String gradeId, String policyVersion, List<String> roles) {
        this(runId, environmentId, employeeId, companyId, schemeId, gradeId, policyVersion, roles, null);
    }
}
