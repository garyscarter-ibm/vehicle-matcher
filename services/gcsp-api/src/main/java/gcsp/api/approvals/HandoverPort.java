package gcsp.api.approvals;

import java.time.Instant;
import java.util.Optional;

/** The appointment outcome port: a completed handover becomes the order's final tracker stage at read time. */
public interface HandoverPort {

    Optional<Handover> completed(gcsp.api.persistence.RunContext ctx, String orderUuid, Instant asOf);

    record Handover(String stage, Instant at, String owner, String nextStep, String providerReference) {}
}
