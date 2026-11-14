package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Outcome;
import java.util.function.Function;

/** Turns a TransactionRunner outcome, or an in-work refusal, into the clock's one result type. */
final class CommandOutcomes {

    private CommandOutcomes() {}

    /** A refusal returned by work that wrote nothing: it rolls back and carries no receipt. */
    static ObjectNode refusal(String status, String code, String reason, boolean retryable, Long currentVersion) {
        ObjectNode body = ClockResult.object();
        ObjectNode refused = body.putObject("refused");
        refused.put("status", status);
        refused.put("code", code);
        refused.put("reason", reason);
        refused.put("retryable", retryable);
        if (currentVersion != null) refused.put("currentVersion", currentVersion);
        return body;
    }

    static ClockResult map(Outcome outcome, Function<JsonNode, ClockResult> onResult) {
        if (outcome instanceof Outcome.Committed c) {
            JsonNode refused = c.result() == null ? null : c.result().get("refused");
            return refused != null ? fromRefusal(refused) : onResult.apply(c.result());
        }
        return failure(outcome);
    }

    static ClockResult.Failure failure(Outcome outcome) {
        if (outcome instanceof Outcome.Conflict c) {
            if ("stale-run".equals(c.code())) return ClockResult.staleRun();
            return ClockResult.conflict(c.code(), c.message(), null);
        }
        if (outcome instanceof Outcome.Refused r) return ClockResult.invalid(r.code(), r.message());
        if (outcome instanceof Outcome.Uncertain u) return ClockResult.uncertain(u.operationId());
        return ClockResult.unavailable("database-unavailable", "The database could not complete the request.", true);
    }

    private static ClockResult.Failure fromRefusal(JsonNode refused) {
        String code = refused.path("code").asText();
        String reason = refused.path("reason").asText();
        boolean retryable = refused.path("retryable").asBoolean(false);
        Long current = refused.has("currentVersion") ? refused.get("currentVersion").asLong() : null;
        return switch (refused.path("status").asText()) {
            case "invalid" -> ClockResult.invalid(code, reason);
            case "conflict" -> ClockResult.conflict(code, reason, current);
            case "not-found" -> ClockResult.notFound(code, reason);
            case "stale-run" -> ClockResult.staleRun();
            default -> ClockResult.unavailable(code, reason, retryable);
        };
    }
}
