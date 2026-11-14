package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;

/**
 * The return purpose of the ordering.appointments.v1 capability. Calls run outside any transaction; each write step
 * answers once per operation id, so a repeat or a reconcile returns the same response.
 */
public interface ReturnProviderPort {

    String CAPABILITY = "ordering.appointments.v1";
    String STEP_REQUEST = "request";
    String STEP_CONFIRM = "confirm";
    String STEP_ACCEPT = "accept";
    String STEP_OUTCOME = "outcome";

    /** none (nothing wired), synthetic or live. */
    String mode();

    Offer offerSlots(SlotPolicy slotPolicy, Instant now);

    Result requestSlot(Operation op);

    Result confirm(Operation op, Instant now);

    Result acceptProposal(Operation op);

    Result confirmOutcome(Operation op, Instant now);

    Result reconcile(Operation op);

    /**
     * One provider call. {@code payload} carries the step's pinned inputs: request {requestedAt}; confirm {confirmAfter,
     * scenario{proposeChange, proposalReason}, slotPolicy}; accept {acceptedAt, proposedSlot}; outcome {confirmAfter, outcome}.
     */
    record Operation(String environmentId, String runId, String operationId, String orderUuid, String step,
            AppointmentSlot slot, JsonNode payload, String inputDigest) {}

    enum Status {
        OK("ok"), ACCEPTED("accepted"), IN_PROGRESS("in-progress"), SCHEDULED("scheduled"), PROPOSED("proposed"),
        RETURNED("returned"), MISSED("missed"), NOT_FOUND("not-found"), CONFLICT("conflict"),
        UNSUPPORTED("unsupported"), UNAVAILABLE("unavailable");

        private final String wire;

        Status(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        static Status ofWire(String text) {
            for (Status s : values()) if (s.wire.equals(text)) return s;
            return null;
        }
    }

    /** A provider answer; code and reason are set only for refusals. {@code fictional} marks every synthetic answer. */
    record Result(Status status, String operationId, String orderUuid, String step, AppointmentSlot slot,
            AppointmentSlot proposedSlot, String proposalId, String providerReference, Instant at, String code,
            String reason, boolean fictional) {

        public ObjectNode toJson() {
            ObjectNode o = ReturnJson.JSON.createObjectNode();
            o.put("status", status.wire());
            o.put("operationId", operationId);
            o.put("orderUuid", orderUuid);
            o.put("step", step);
            if (slot != null) o.set("slot", slot.toJson());
            if (proposedSlot != null) o.set("proposedSlot", proposedSlot.toJson());
            if (proposalId != null) o.put("proposalId", proposalId);
            if (providerReference != null) o.put("providerReference", providerReference);
            if (at != null) o.put("at", ReturnJson.format(at));
            if (code != null) o.put("code", code);
            if (reason != null) o.put("reason", reason);
            o.put("fictional", fictional);
            return o;
        }

        /** Null when the stored node is not a readable result. */
        public static Result fromJson(JsonNode n) {
            if (n == null || !n.isObject()) return null;
            Status status = Status.ofWire(n.path("status").asText(null));
            if (status == null) return null;
            return new Result(status, n.path("operationId").asText(null), n.path("orderUuid").asText(null),
                    n.path("step").asText(null), AppointmentSlot.fromJson(n.get("slot")),
                    AppointmentSlot.fromJson(n.get("proposedSlot")), n.path("proposalId").asText(null),
                    n.path("providerReference").asText(null), ReturnJson.parse(n.path("at").asText(null)),
                    n.path("code").asText(null), n.path("reason").asText(null), n.path("fictional").asBoolean(false));
        }
    }

    /** The slots a provider offers for a slot policy, or why it cannot. */
    record Offer(Status status, List<AppointmentSlot> slots, String code, String reason, boolean fictional) {}
}
