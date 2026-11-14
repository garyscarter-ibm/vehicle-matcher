package gcsp.api.ordering;

/** Mode none: nothing is ever submitted and nothing is ever confirmed. */
public final class UnconfiguredOrderingProvider implements OrderingProviderPort {

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public String provider() {
        return "none";
    }

    @Override
    public ProviderResponse execute(OrderingScope scope, ProviderRequest request) {
        return ProviderResponse.of(Status.UNKNOWN, scope, request, "ordering-provider-not-configured");
    }

    @Override
    public ProviderResponse reconcile(OrderingScope scope, ProviderRequest request) {
        return ProviderResponse.of(Status.UNKNOWN, scope, request, "ordering-provider-not-configured");
    }
}
