package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** The injected handover readiness reader: ready, not ready, unavailable or throwing, counting every read. */
final class StubReadiness implements HandoverReadinessPort {

    enum Mode { READY, NOT_READY, UNAVAILABLE, THROWS }

    final AtomicInteger reads = new AtomicInteger();
    volatile Mode mode = Mode.NOT_READY;

    @Override
    public HandoverReadiness read(RunContext context, String orderUuid) {
        reads.incrementAndGet();
        return switch (mode) {
            case READY -> new HandoverReadiness.Ok(true, "ready", true, true, List.of(), "docs-rev-7");
            case NOT_READY -> new HandoverReadiness.Ok(false, "documents-pending", false, true,
                    List.of("signed-order-form"), "docs-rev-3");
            case UNAVAILABLE -> new HandoverReadiness.Unavailable();
            case THROWS -> throw new IllegalStateException("documents service is down");
        };
    }
}
