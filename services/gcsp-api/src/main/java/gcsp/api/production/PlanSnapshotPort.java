package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Greg's current order plan as Production submission reads it, computed for the caller's own principal. */
public interface PlanSnapshotPort {

    String mode();

    Reading current(RunContext ctx, Principal principal);

    /** The plan under Greg's draft changes (null = none, the plan above); a port that cannot draft says so. */
    default Reading current(RunContext ctx, Principal principal, JsonNode changes) {
        return changes == null ? current(ctx, principal)
                : new Unavailable("plan-changes-unsupported", "This plan source cannot plan under edited limits.");
    }

    sealed interface Reading permits Snapshot, Unavailable, Invalid {}

    /** The plan and the canonical changes it was drawn under (an empty array when none). */
    record Snapshot(String planId, Map<String, String> versions, boolean feasible, Instant asOf, List<Line> lines,
            JsonNode changes) implements Reading {
        public Snapshot {
            if (changes == null) changes = JsonNodeFactory.instance.arrayNode();
        }

        public Snapshot(String planId, Map<String, String> versions, boolean feasible, Instant asOf, List<Line> lines) {
            this(planId, versions, feasible, asOf, lines, null);
        }
    }

    /** Greg's changes were refused by the planner's own validation. */
    record Invalid(String code, String reason) implements Reading {}

    record Line(String lineId, String model, String derivative, int quantity) {}

    record Unavailable(String code, String reason) implements Reading {}
}
