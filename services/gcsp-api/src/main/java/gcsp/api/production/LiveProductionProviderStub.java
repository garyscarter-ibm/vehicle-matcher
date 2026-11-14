package gcsp.api.production;

import java.util.List;

/** Live-shaped boundary: no BMW Production system is reachable, so every call is refused and nothing is sent. */
public final class LiveProductionProviderStub implements ProductionProviderPort {

    static final String CODE = "live-production-unsupported";
    static final String REASON = "Live Production ordering is not connected yet. Nothing was sent.";

    @Override
    public String mode() {
        return "live";
    }

    @Override
    public Description describe() {
        return new Description("live", "live-production:stub", null, "unsupported", List.of());
    }

    @Override
    public Answer submit(Operation operation) {
        return Answer.of(Status.UNSUPPORTED, operation.operationId(), CODE, REASON);
    }

    @Override
    public Answer reconcile(Operation operation) {
        return submit(operation);
    }
}
