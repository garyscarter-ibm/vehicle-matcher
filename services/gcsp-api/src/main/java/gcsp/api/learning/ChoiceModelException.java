package gcsp.api.learning;

/** Node ChoiceModelError: a stable code plus the offending field. */
public final class ChoiceModelException extends RuntimeException {

    public static final String INVALID = "invalid-input";
    public static final String CORRUPT = "artifact-corrupt";
    public static final String UNAVAILABLE = "artifact-unavailable";

    private final String code;
    private final String field;

    public ChoiceModelException(String code, String field) {
        super("Choice model " + code + ": " + field + ".");
        this.code = code;
        this.field = field;
    }

    public String code() {
        return code;
    }

    public String field() {
        return field;
    }

    /** Node requireChoice with the default invalid-input code. */
    static void require(boolean condition, String field) {
        if (!condition) throw new ChoiceModelException(INVALID, field);
    }

    static void require(boolean condition, String field, String code) {
        if (!condition) throw new ChoiceModelException(code, field);
    }
}
