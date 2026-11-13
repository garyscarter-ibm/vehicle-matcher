package gcsp.api.identity;

/**
 * Resolves a bearer access token into a server-owned principal. Selected at startup by
 * {@code gcsp.identity.provider}.
 */
public interface IdentityPort {

    /** Stable provider name, reported by readiness and startup logs. */
    String mode();

    /** Never invents a principal: anything not positively validated and mapped is refused. */
    IdentityResult resolve(String bearerToken);
}
