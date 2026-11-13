package gcsp.api.auth;

/** A typed 401/403/503 refusal; mapped to the JSON error envelope by {@link IdentityRefusalMapper}. */
public final class IdentityRefusal extends RuntimeException {

    private final int http;
    private final String status;
    private final String code;
    private final String reason;
    private final boolean retryable;

    public IdentityRefusal(int http, String status, String code, String reason, boolean retryable) {
        super(code, null, false, false);
        this.http = http;
        this.status = status;
        this.code = code;
        this.reason = reason;
        this.retryable = retryable;
    }

    public int http() {
        return http;
    }

    public String status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String reason() {
        return reason;
    }

    public boolean retryable() {
        return retryable;
    }
}
