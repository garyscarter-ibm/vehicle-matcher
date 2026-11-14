package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Outcome;

/** The typed answer of a document command or read; slice 3 maps http onto the response. */
public record DocumentOutcome(int http, String status, String code, String reason, boolean retryable, JsonNode value,
        String operationId) {

    public static final String UNAVAILABLE_REASON =
            "Document tracking is unavailable. Ask the scheme team to check the service.";

    public static DocumentOutcome ok(JsonNode value) {
        return new DocumentOutcome(200, "ok", null, null, false, value, null);
    }

    public static DocumentOutcome invalid(String field, String reason) {
        ObjectNode value = JsonNodeFactory.instance.objectNode();
        value.putArray("reasons").addObject().put("field", field).put("reason", reason);
        value.put("action", "review-and-retry");
        return new DocumentOutcome(400, "invalid", "invalid-document-command", reason, false, value, null);
    }

    public static DocumentOutcome forbidden(String code, String reason) {
        return new DocumentOutcome(403, "forbidden", code, reason, false, null, null);
    }

    public static DocumentOutcome notFound(String code, String reason) {
        return new DocumentOutcome(404, "not-found", code, reason, false, null, null);
    }

    public static DocumentOutcome conflict(String code, String reason, boolean retryable) {
        return new DocumentOutcome(409, "conflict", code, reason, retryable, null, null);
    }

    public static DocumentOutcome unsupported(String code, String reason) {
        return new DocumentOutcome(422, "unsupported", code, reason, false, null, null);
    }

    public static DocumentOutcome pending(String code, String reason, String operationId) {
        return new DocumentOutcome(202, "pending", code, reason, false, null, operationId);
    }

    public static DocumentOutcome uncertain(String operationId) {
        return new DocumentOutcome(202, "uncertain", "outcome-uncertain",
                "The outcome is not known yet. Check before trying again.", false, null, operationId);
    }

    public static DocumentOutcome unavailable(String code, String reason) {
        return new DocumentOutcome(503, "unavailable", code, reason, true, null, null);
    }

    /** Maps a runner outcome that is not a success; a committed one is passed through as ok. */
    public static DocumentOutcome from(Outcome o) {
        return switch (o) {
            case Outcome.Committed c -> ok(c.result());
            case Outcome.Conflict c -> conflict(c.code(), c.message(), c.retryable());
            case Outcome.Refused r -> conflict(r.code(), r.message(), false);
            case Outcome.Uncertain u -> uncertain(u.operationId());
            case Outcome.Unavailable u -> unavailable("documents-unavailable", UNAVAILABLE_REASON);
        };
    }
}
