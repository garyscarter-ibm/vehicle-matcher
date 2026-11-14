package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;

/** A port read: ok carries the JSON fact set; the other statuses carry only a code. */
public record SourceResult(String status, String code, JsonNode value) {

    public static final String OK = "ok";
    public static final String NOT_FOUND = "not-found";
    public static final String UNAVAILABLE = "unavailable";
    public static final String INVALID = "invalid";

    public static SourceResult ok(JsonNode value) {
        return new SourceResult(OK, null, value);
    }

    public static SourceResult notFound() {
        return new SourceResult(NOT_FOUND, null, null);
    }

    public static SourceResult unavailable(String code) {
        return new SourceResult(UNAVAILABLE, code, null);
    }

    public static SourceResult invalid(String code) {
        return new SourceResult(INVALID, code, null);
    }

    public boolean isOk() {
        return OK.equals(status);
    }
}
