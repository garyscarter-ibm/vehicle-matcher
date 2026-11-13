package gcsp.api.auth;

import gcsp.api.identity.Principal;

/** Role and ownership checks; callers may map an ownership refusal to 404 where the privacy policy requires it. */
public final class Access {

    private static final String REASON = "Your account cannot use this action.";

    private Access() {}

    public static void requireAnyRole(Principal p, Role... allowed) {
        for (Role r : allowed) {
            if (p.roles().contains(r.wire())) {
                return;
            }
        }
        throw new IdentityRefusal(403, "forbidden", "role-required", REASON, false);
    }

    public static boolean owns(Principal p, String ownerEmployeeId) {
        return p.roles().contains(Role.EMPLOYEE.wire()) && p.employeeId() != null
                && ownerEmployeeId != null && p.employeeId().equals(ownerEmployeeId);
    }

    public static void requireOwner(Principal p, String ownerEmployeeId) {
        if (!owns(p, ownerEmployeeId)) {
            throw new IdentityRefusal(403, "forbidden", "not-resource-owner", REASON, false);
        }
    }
}
