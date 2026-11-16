package gcsp.api.comparison;

/** A comparison input refusal. The code and key match the Node ComparisonInputError. */
public final class ComparisonInputError extends RuntimeException {

    private final String code;
    private final String key;

    public ComparisonInputError(String code, String key) {
        super("Comparison input " + code + ": " + key + ".", null, false, false);
        this.code = code;
        this.key = key;
    }

    public String code() {
        return code;
    }

    public String key() {
        return key;
    }
}
