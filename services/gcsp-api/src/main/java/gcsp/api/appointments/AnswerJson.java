package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;

/** The stored (jsonb) form of an answer; status names the variant. */
final class AnswerJson {

    private static final ObjectMapper JSON = new ObjectMapper();

    private AnswerJson() {}

    static ObjectNode toJson(ProviderAnswer a) {
        ObjectNode o = JSON.createObjectNode();
        switch (a) {
            case ProviderAnswer.Accepted d -> done(o, "accepted", d);
            case ProviderAnswer.Scheduled d -> done(o, "scheduled", d);
            case ProviderAnswer.Completed d -> done(o, "completed", d);
            case ProviderAnswer.Proposed d -> {
                done(o, "proposed", d);
                o.set("proposedSlot", d.proposedSlot().toJson());
                o.put("proposalId", d.proposalId());
                if (d.reason() == null) o.putNull("reason"); else o.put("reason", d.reason());
            }
            case ProviderAnswer.InProgress d -> scope(o, "in-progress", d.operationId(), d.orderUuid(), d.step());
            case ProviderAnswer.NotFound d -> scope(o, "not-found", d.operationId(), d.orderUuid(), d.step());
            case ProviderAnswer.Unsupported d -> o.put("status", "unsupported").put("code", d.code()).put("reason", d.reason());
            case ProviderAnswer.Conflict d -> o.put("status", "conflict").put("reason", d.reason());
            case ProviderAnswer.Unknown d -> o.put("status", "unknown");
        }
        return o;
    }

    /** The answer, or Unknown when the stored JSON is not a recognised answer. */
    static ProviderAnswer fromJson(JsonNode n) {
        if (n == null || !n.isObject()) return new ProviderAnswer.Unknown();
        String status = n.path("status").asText("");
        String op = n.path("operationId").asText(null);
        String order = n.path("orderUuid").asText(null);
        String step = n.path("step").asText(null);
        switch (status) {
            case "in-progress":
                return new ProviderAnswer.InProgress(op, order, step);
            case "not-found":
                return new ProviderAnswer.NotFound(op, order, step);
            case "unsupported":
                return new ProviderAnswer.Unsupported(n.path("code").asText(null), n.path("reason").asText(null));
            case "conflict":
                return new ProviderAnswer.Conflict(n.path("reason").asText(null));
            case "accepted", "scheduled", "completed", "proposed":
                break;
            default:
                return new ProviderAnswer.Unknown();
        }
        Slot slot = Slot.fromJson(n.get("slot"));
        Instant at = Iso.parse(n.path("at").asText(null));
        String ref = n.path("providerReference").asText(null);
        if (slot == null || at == null || !Values.id(n.get("providerReference"), 512) || op == null || order == null
                || step == null) return new ProviderAnswer.Unknown();
        return switch (status) {
            case "accepted" -> new ProviderAnswer.Accepted(op, order, step, slot, ref, at);
            case "scheduled" -> new ProviderAnswer.Scheduled(op, order, step, slot, ref, at);
            case "completed" -> new ProviderAnswer.Completed(op, order, step, slot, ref, at);
            default -> {
                Slot proposed = Slot.fromJson(n.get("proposedSlot"));
                yield proposed == null || !Values.id(n.get("proposalId"), 512) ? new ProviderAnswer.Unknown()
                        : new ProviderAnswer.Proposed(op, order, step, slot, ref, at, proposed,
                                n.get("proposalId").asText(), n.path("reason").isTextual() ? n.get("reason").asText() : null);
            }
        };
    }

    private static void done(ObjectNode o, String status, ProviderAnswer.Done d) {
        scope(o, status, d.operationId(), d.orderUuid(), d.step());
        o.set("slot", d.slot().toJson());
        o.put("providerReference", d.providerReference());
        o.put("at", Iso.format(d.at()));
    }

    private static void scope(ObjectNode o, String status, String op, String order, String step) {
        o.put("status", status).put("operationId", op).put("orderUuid", order).put("step", step);
    }
}
