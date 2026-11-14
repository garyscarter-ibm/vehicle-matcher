package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of a release delivery; slice s2 maps it to HTTP. Uncertain means inspect the tick, never resubmit blindly. */
public record ReleaseResult(Status status, String code, String reason, boolean retryable, String tickId,
        boolean replayed, JsonNode value) {

    public enum Status { OK, UNAVAILABLE, CONFLICT, INVALID, UNCERTAIN }

    static ReleaseResult ok(String tickId, JsonNode value, boolean replayed) {
        return new ReleaseResult(Status.OK, "ok", null, false, tickId, replayed, value);
    }

    static ReleaseResult unavailable(String tickId, String code, String reason) {
        return new ReleaseResult(Status.UNAVAILABLE, code, reason, true, tickId, false, null);
    }

    static ReleaseResult conflict(String tickId, String code, String reason, boolean retryable) {
        return new ReleaseResult(Status.CONFLICT, code, reason, retryable, tickId, false, null);
    }

    static ReleaseResult invalid(String tickId, String code, String reason) {
        return new ReleaseResult(Status.INVALID, code, reason, false, tickId, false, null);
    }

    static ReleaseResult uncertain(String tickId) {
        return new ReleaseResult(Status.UNCERTAIN, "outcome-uncertain",
                "The outcome is unknown; inspect the tick before any resubmit.", false, tickId, false, null);
    }
}
