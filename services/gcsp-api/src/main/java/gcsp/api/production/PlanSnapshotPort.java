package gcsp.api.production;

import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Greg's current order plan as Production submission reads it, computed for the caller's own principal. */
public interface PlanSnapshotPort {

    String mode();

    Reading current(RunContext ctx, Principal principal);

    sealed interface Reading permits Snapshot, Unavailable {}

    record Snapshot(String planId, Map<String, String> versions, boolean feasible, Instant asOf, List<Line> lines)
            implements Reading {}

    record Line(String lineId, String model, String derivative, int quantity) {}

    record Unavailable(String code, String reason) implements Reading {}
}
