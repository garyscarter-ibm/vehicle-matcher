package gcsp.api.identity;

import java.util.List;

/** Server-resolved context for one caller; employeeId is null unless an employee mapping exists. */
public record Principal(
        String subject,
        List<String> roles,
        String environmentId,
        String runId,
        String employeeId,
        String policyVersion,
        List<String> capabilities) {

    public Principal {
        roles = List.copyOf(roles);
        capabilities = List.copyOf(capabilities);
    }
}
