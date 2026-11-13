package gcsp.api.identity;

/** Default port: no provider is configured, so every token is refused rather than trusted. */
public final class UnconfiguredIdentity implements IdentityPort {

    @Override
    public String mode() {
        return IdentitySelection.NONE;
    }

    @Override
    public IdentityResult resolve(String bearerToken) {
        return new IdentityResult.Unavailable("identity-provider-not-configured", false);
    }
}
