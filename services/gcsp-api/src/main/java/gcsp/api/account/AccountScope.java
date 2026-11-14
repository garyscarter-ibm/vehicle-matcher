package gcsp.api.account;

import java.util.List;

/** Trusted identity for one account read; the service fills the membership fields from the employment port. */
public record AccountScope(String environmentId, String runId, String employeeId, String name, List<String> roles,
        String companyId, String schemeId, String gradeId, String entitlementSlotId, String policyVersion) {

    AccountScope withMembership(String nameValue, String company, String scheme, String grade, String slot) {
        return new AccountScope(environmentId, runId, employeeId, nameValue != null ? nameValue : name, roles, company,
                scheme, grade, slot, policyVersion);
    }
}
