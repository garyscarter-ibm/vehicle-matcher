package gcsp.api.comparison;

/** A comparison run refusal. The code and boundary match the Node ComparisonRunError. */
public final class ComparisonRunError extends RuntimeException {

    private final String code;
    private final String boundary;

    public ComparisonRunError(String code, String boundary) {
        super("Comparison run " + code + ": " + boundary + ".", null, false, false);
        this.code = code;
        this.boundary = boundary;
    }

    public String code() {
        return code;
    }

    public String boundary() {
        return boundary;
    }
}
