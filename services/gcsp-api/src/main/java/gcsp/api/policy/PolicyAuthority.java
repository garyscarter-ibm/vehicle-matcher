package gcsp.api.policy;

import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import jakarta.enterprise.context.ApplicationScoped;

/** The seam that decides who may publish policy: the greg role today. Integration may replace it. */
@ApplicationScoped
public class PolicyAuthority {

    public boolean mayPublish(Principal principal) {
        return principal != null && principal.roles().contains(Role.GREG.wire());
    }
}
