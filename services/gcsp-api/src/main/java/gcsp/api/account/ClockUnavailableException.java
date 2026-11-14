package gcsp.api.account;

public class ClockUnavailableException extends RuntimeException {
    public ClockUnavailableException(String message) {
        super(message);
    }
}
