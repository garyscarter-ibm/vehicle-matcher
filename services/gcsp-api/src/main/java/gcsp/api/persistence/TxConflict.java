package gcsp.api.persistence;

/** Thrown inside a command transaction to roll back and answer with a typed conflict. */
public final class TxConflict extends RuntimeException {

    private final String code;

    public TxConflict(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
