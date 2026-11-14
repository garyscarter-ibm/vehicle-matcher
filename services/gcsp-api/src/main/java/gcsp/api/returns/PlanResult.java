package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** The typed answer of a plan operation; slice s4 maps it to HTTP (Ok 200, Pending 202, Refused to its status). */
public sealed interface PlanResult {

    /** One field-level reason for a refusal. */
    record Reason(String field, String reason) {}

    record Ok(JsonNode json) implements PlanResult {}

    /** The provider outcome is unknown; the operation stays pending and is reconciled later. */
    record Pending(JsonNode json, String operationId) implements PlanResult {}

    /** A refusal; {@code plan} carries the plan as it stands for an unsupported or stale answer, else null. */
    record Refused(int http, String code, String reason, boolean retryable, List<Reason> reasons, JsonNode plan)
            implements PlanResult {

        public Refused {
            reasons = reasons == null ? List.of() : List.copyOf(reasons);
        }

        public Refused withPlan(JsonNode current) {
            return new Refused(http, code, reason, retryable, reasons, current);
        }
    }
}
