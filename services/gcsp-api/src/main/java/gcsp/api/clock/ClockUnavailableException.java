package gcsp.api.clock;

/** The clock tables could not be read; no value is guessed. */
public final class ClockUnavailableException extends RuntimeException {

    public ClockUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
