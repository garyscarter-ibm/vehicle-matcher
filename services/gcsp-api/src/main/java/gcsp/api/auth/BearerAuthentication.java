package gcsp.api.auth;

import gcsp.api.identity.IdentityPort;
import gcsp.api.identity.IdentityResult;
import gcsp.api.identity.Principal;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Parses the Authorization header and maps the identity port's result to a principal or a refusal. */
@ApplicationScoped
public class BearerAuthentication {

    @Inject
    IdentityPort identity;

    public Principal authenticate(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            throw new IdentityRefusal(401, "unauthenticated", "bearer-missing", "Sign in to continue.", false);
        }
        String token = bearer(authorizationHeader);
        if (token == null) {
            throw new IdentityRefusal(401, "unauthenticated", "bearer-invalid", "Sign in to continue.", false);
        }
        IdentityResult result = identity.resolve(token);
        if (result instanceof IdentityResult.Resolved r) {
            return r.principal();
        }
        if (result instanceof IdentityResult.Rejected r) {
            throw new IdentityRefusal(401, "unauthenticated", r.code(), "Sign in to continue.", false);
        }
        if (result instanceof IdentityResult.Unmapped r) {
            throw new IdentityRefusal(403, "forbidden", r.code(),
                    "This account is not set up for this environment.", false);
        }
        IdentityResult.Unavailable u = (IdentityResult.Unavailable) result;
        throw new IdentityRefusal(503, "unavailable", u.code(),
                "Sign-in is not available on this service yet.", u.retryable());
    }

    private static String bearer(String header) {
        String[] parts = header.trim().split("\\s+");
        if (parts.length != 2 || !parts[0].equalsIgnoreCase("Bearer") || parts[1].isEmpty()) {
            return null;
        }
        return parts[1];
    }
}
