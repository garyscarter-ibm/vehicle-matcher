package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.List;

/** What a service call answers; the HTTP layer maps each variant to a status (Unsupported is 422, Pending is 202). */
public sealed interface AppointmentResult {

    /** One refused field with its on-screen reason. */
    record Reason(String field, String reason) {}

    /** The read model (or summary) as the value of {status:"ok", value}. */
    record Ok(JsonNode value) implements AppointmentResult {}

    record Invalid(String code, List<Reason> reasons) implements AppointmentResult {
        public Invalid {
            reasons = List.copyOf(reasons);
        }
    }

    record Forbidden(String code, String reason) implements AppointmentResult {}

    record NotFound(String resourceType, String reason) implements AppointmentResult {}

    /** extra carries the code's own facts, e.g. currentVersion or reasons; never null. */
    record Conflict(String code, String reason, JsonNode extra) implements AppointmentResult {
        public Conflict(String code, String reason) {
            this(code, reason, JsonNodeFactory.instance.objectNode());
        }
    }

    /** The provider refuses; appointment is the read model when one exists, else null. */
    record Unsupported(String code, String reason, JsonNode appointment) implements AppointmentResult {}

    record Unavailable(String code, String reason, boolean retryable) implements AppointmentResult {}

    /** The command's commit is uncertain; inspect the command id (operationId) before any resubmit. */
    record Pending(String operationId) implements AppointmentResult {}
}
