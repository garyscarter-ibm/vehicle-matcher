package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** Default handover port: no appointment outcome is connected, so no order is ever handed over. */
public final class NoHandover implements HandoverPort {

    @Override
    public Optional<Handover> completed(RunContext ctx, String orderUuid, Instant asOf) {
        return Optional.empty();
    }
}
