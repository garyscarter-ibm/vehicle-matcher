package gcsp.api.learning;

/** A thrown Node Error from the observed projection; the message is the stable failure code. */
public final class LearningSourceException extends RuntimeException {

    private final String code;

    public LearningSourceException(String code) {
        super(code);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
