package gcsp.api.production;

import java.util.List;

/** Default provider (mode none): no Production system is selected, so every call is unavailable. */
public final class UnconfiguredProductionProvider implements ProductionProviderPort {

    static final String CODE = "production-not-configured";
    static final String REASON = "Production ordering is not connected yet. Nothing was sent.";

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public Description describe() {
        return new Description("none", "none", null, "unavailable", List.of());
    }

    @Override
    public Answer submit(Operation operation) {
        return Answer.of(Status.UNAVAILABLE, operation.operationId(), CODE, REASON);
    }

    @Override
    public Answer reconcile(Operation operation) {
        return submit(operation);
    }
}
