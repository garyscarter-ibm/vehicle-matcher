package gcsp.api.supply;

/** No stock source is wired yet: every pull is unavailable. */
public final class UnconfiguredProvider implements SupplyProvider {

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public ProviderResponse pull(PullRequest request) {
        return new ProviderResponse.Unavailable("supply-provider-not-configured", "No stock source is configured.");
    }
}
