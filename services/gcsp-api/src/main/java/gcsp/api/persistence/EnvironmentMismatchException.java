package gcsp.api.persistence;

/** Startup refusal: the database is not the one this deployment is configured for. */
public class EnvironmentMismatchException extends IllegalStateException {
    public EnvironmentMismatchException(String message) {
        super(message);
    }
}
