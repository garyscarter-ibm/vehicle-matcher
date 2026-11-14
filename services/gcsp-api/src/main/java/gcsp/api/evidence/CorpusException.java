package gcsp.api.evidence;

/** A corpus integrity failure carrying the Node-compatible machine code. */
public final class CorpusException extends RuntimeException {

    private final String code;

    public CorpusException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
