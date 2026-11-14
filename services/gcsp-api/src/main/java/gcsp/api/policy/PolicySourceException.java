package gcsp.api.policy;

/** A source failure. The code is the only detail that ever reaches a caller. */
public class PolicySourceException extends Exception {

    public static final String INVALID = "source-invalid";
    public static final String UNAVAILABLE = "source-unavailable";

    private final String code;

    public PolicySourceException(String code) {
        super(INVALID.equals(code) ? "Policy source is invalid." : "Policy source is unavailable.");
        this.code = INVALID.equals(code) ? INVALID : UNAVAILABLE;
    }

    public String code() {
        return code;
    }
}
