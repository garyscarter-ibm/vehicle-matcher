package gcsp.api.notify;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.net.URI;
import java.time.Duration;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Chooses the mail transport from gcsp.mail.transport: unset keeps mail captured, brevo needs full settings. */
@ApplicationScoped
public class MailTransportSelection {

    @ConfigProperty(name = "gcsp.mail.transport")
    Optional<String> configured;

    @ConfigProperty(name = "gcsp.mail.brevo.api-key")
    Optional<String> apiKey;

    @ConfigProperty(name = "gcsp.mail.from")
    Optional<String> from;

    @ConfigProperty(name = "gcsp.mail.from-name")
    Optional<String> fromName;

    @ConfigProperty(name = "gcsp.mail.public-base-url")
    Optional<String> publicBase;

    @ConfigProperty(name = "gcsp.mail.brevo.endpoint")
    String endpoint;

    @ConfigProperty(name = "gcsp.mail.brevo.timeout")
    Duration timeout;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> sources;

    private MailTransport built;

    void checkAtStartup(@Observes StartupEvent event) {
        if (isBrevo(configured)) settings();
        else select(configured);
    }

    /** Built once, on first use; brevo needs the datasource, so persistence must be active. */
    public synchronized MailTransport transport() {
        if (built == null) {
            if (!isBrevo(configured)) {
                built = select(configured);
            } else {
                BrevoSettings s = settings();
                if (!persistence.active()) throw new IllegalStateException("Brevo mail needs persistence to be configured");
                built = new BrevoTransport(sources.get(), s, InstantSource.system(), BrevoTransport.newClient(s.timeout()));
            }
        }
        return built;
    }

    private BrevoSettings settings() {
        return brevoSettings(apiKey.orElse(""), from.orElse(""), fromName.orElse(""), publicBase.orElse(""), endpoint,
                timeout, LaunchMode.current() == LaunchMode.TEST);
    }

    private static boolean isBrevo(Optional<String> value) {
        return "brevo".equals(value.map(String::strip).orElse(""));
    }

    /** Unset or blank keeps mail captured; any other value is refused (brevo is built by the instance). */
    static MailTransport select(Optional<String> value) {
        if (value.map(String::strip).orElse("").isEmpty()) {
            return new CapturedTransport();
        }
        throw new IllegalStateException("Unknown mail transport: unset GCSP_MAIL_TRANSPORT or use a supported value");
    }

    /** Validates every Brevo setting; errors name the variable and never carry a value. */
    static BrevoSettings brevoSettings(String key, String sender, String senderName, String base, String endpoint,
            Duration timeout, boolean loopbackHttpAllowed) {
        List<String> bad = new ArrayList<>();
        if (!plain(key) || key.chars().anyMatch(Character::isWhitespace)) bad.add("GCSP_BREVO_API_KEY");
        if (!plain(sender) || sender.length() > 254 || !NotificationEmailResource.validEmail(sender)) bad.add("GCSP_MAIL_FROM");
        if (!plain(senderName)) bad.add("GCSP_MAIL_FROM_NAME");
        Optional<URI> publicBase = PublicBase.parse(base);
        if (publicBase.isEmpty()) bad.add("GCSP_PUBLIC_BASE_URL");
        URI endpointUri = endpoint(endpoint, loopbackHttpAllowed);
        if (endpointUri == null) bad.add("gcsp.mail.brevo.endpoint");
        if (timeout == null || timeout.isZero() || timeout.isNegative() || timeout.compareTo(Duration.ofSeconds(60)) > 0) {
            bad.add("gcsp.mail.brevo.timeout");
        }
        if (!bad.isEmpty()) {
            throw new IllegalStateException("GCSP_MAIL_TRANSPORT=brevo needs valid settings: " + String.join(", ", bad));
        }
        return new BrevoSettings(key, sender, senderName, publicBase.get(), endpointUri, timeout);
    }

    /** Non-blank, trimmed, no control characters or whitespace inside a key. */
    private static boolean plain(String value) {
        return value != null && !value.isEmpty() && value.equals(value.strip())
                && value.chars().noneMatch(Character::isISOControl);
    }

    private static URI endpoint(String value, boolean loopbackHttpAllowed) {
        if (!plain(value) || value.chars().anyMatch(Character::isWhitespace)) return null;
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (host == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) return null;
            if ("https".equals(uri.getScheme())) return uri;
            boolean loopback = host.equals("127.0.0.1") || host.equals("localhost") || host.equals("[::1]");
            return "http".equals(uri.getScheme()) && loopback && loopbackHttpAllowed ? uri : null;
        } catch (java.net.URISyntaxException e) {
            return null;
        }
    }
}
