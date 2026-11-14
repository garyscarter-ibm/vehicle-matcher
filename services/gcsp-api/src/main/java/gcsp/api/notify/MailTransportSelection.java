package gcsp.api.notify;

import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Chooses the mail transport from gcsp.mail.transport: unset keeps mail captured, any unknown value stops startup. */
@ApplicationScoped
public class MailTransportSelection {

    @ConfigProperty(name = "gcsp.mail.transport")
    Optional<String> configured;

    void checkAtStartup(@Observes StartupEvent event) {
        select(configured);
    }

    public MailTransport transport() {
        return select(configured);
    }

    /** Unset or blank keeps mail captured; any other value is refused at startup. */
    static MailTransport select(Optional<String> value) {
        if (value.map(String::strip).orElse("").isEmpty()) {
            return new CapturedTransport();
        }
        throw new IllegalStateException("Unknown mail transport: unset GCSP_MAIL_TRANSPORT or use a supported value");
    }
}
