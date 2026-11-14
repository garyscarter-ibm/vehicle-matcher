package gcsp.api.notify;

import java.net.URI;
import java.time.Duration;

/** Validated Brevo settings. The api key never appears in toString. */
public record BrevoSettings(String apiKey, String senderEmail, String senderName, URI publicBase, URI endpoint,
        Duration timeout) {

    @Override
    public String toString() {
        return "BrevoSettings[endpoint=" + endpoint + ", timeout=" + timeout + "]";
    }
}
