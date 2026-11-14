package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The one answer type of the clock service; the HTTP layer maps status, code and retryable. */
public sealed interface ClockResult {

    enum Status { OK, INVALID, CONFLICT, UNAVAILABLE, STALE_RUN, NOT_FOUND, UNCERTAIN }

    Status status();

    default boolean ok() {
        return status() == Status.OK;
    }

    record Ok(JsonNode value) implements ClockResult {
        public Status status() {
            return Status.OK;
        }
    }

    /** reason is plain English; currentVersion is set on a stale-version conflict; operationId on UNCERTAIN. */
    record Failure(Status status, String code, String reason, boolean retryable, Long currentVersion,
            String operationId, JsonNode detail) implements ClockResult {

        Failure withCode(String newCode) {
            return new Failure(status, newCode, reason, retryable, currentVersion, operationId, detail);
        }

        Failure withDetail(JsonNode newDetail) {
            return new Failure(status, code, reason, retryable, currentVersion, operationId, newDetail);
        }

        Failure withCurrentVersion(Long version) {
            return new Failure(status, code, reason, retryable, version, operationId, detail);
        }
    }

    static ClockResult ok(JsonNode value) {
        return new Ok(value);
    }

    static Failure invalid(String code, String reason) {
        return new Failure(Status.INVALID, code, reason, false, null, null, null);
    }

    static Failure notFound(String code, String reason) {
        return new Failure(Status.NOT_FOUND, code, reason, false, null, null, null);
    }

    static Failure conflict(String code, String reason, Long currentVersion) {
        return new Failure(Status.CONFLICT, code, reason, false, currentVersion, null, null);
    }

    static Failure unavailable(String code, String reason, boolean retryable) {
        return new Failure(Status.UNAVAILABLE, code, reason, retryable, null, null, null);
    }

    static Failure unavailable(String code, String reason, boolean retryable, ObjectNode detail) {
        return new Failure(Status.UNAVAILABLE, code, reason, retryable, null, null, detail);
    }

    static Failure staleRun() {
        return new Failure(Status.STALE_RUN, "stale-run", "This page is out of date. Reload to see the latest.",
                false, null, null, null);
    }

    static Failure uncertain(String operationId) {
        return new Failure(Status.UNCERTAIN, "outcome-uncertain",
                "The result of this command is not known. Check it before sending it again.", false, null,
                operationId, null);
    }

    static ObjectNode object() {
        return JsonNodeFactory.instance.objectNode();
    }
}
