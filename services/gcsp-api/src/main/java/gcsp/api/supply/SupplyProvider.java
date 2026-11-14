package gcsp.api.supply;

/** Port to the stock source. Called outside any transaction; it may throw, which counts as unavailable. */
public interface SupplyProvider {

    String mode();

    ProviderResponse pull(PullRequest request);
}
