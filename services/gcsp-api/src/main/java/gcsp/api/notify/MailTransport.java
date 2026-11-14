package gcsp.api.notify;

import gcsp.api.persistence.RunContext;

/** Port for sending a rendered message. Called outside any transaction; may be called again for the same attempt. */
public interface MailTransport {

    Result send(RunContext ctx, DeliveryAttempt attempt, OfferMessage message);

    /** "captured" or "configured": stored on the delivery when the message is accepted. */
    String name();

    sealed interface Result permits Accepted, Failed, StaleRun {}

    record Accepted() implements Result {}

    /** A fixed safe code (see MailFailureCodes); provider text never travels through here. */
    record Failed(String code, boolean retryable) implements Result {}

    record StaleRun() implements Result {}
}
