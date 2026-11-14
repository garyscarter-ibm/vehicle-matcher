package gcsp.api.notify;

import gcsp.api.persistence.RunContext;

/** Capture is the dispatcher's own sent commit storing the message, so this transport performs no I/O. */
public final class CapturedTransport implements MailTransport {

    @Override
    public Result send(RunContext ctx, DeliveryAttempt attempt, OfferMessage message) {
        return new Accepted();
    }

    @Override
    public String name() {
        return "captured";
    }
}
