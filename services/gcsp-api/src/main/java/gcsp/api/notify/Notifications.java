package gcsp.api.notify;

import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.InstantSource;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The notification seam for the HTTP resources and the drain: one dispatcher, built only when persistence is on. */
@ApplicationScoped
public class Notifications {

    @Inject
    Persistence persistence;

    @Inject
    PolicyService policy;

    @Inject
    MailTransportSelection transports;

    @Inject
    Instance<AgroalDataSource> sources;

    @ConfigProperty(name = "gcsp.environment-id")
    Optional<String> environmentId;

    @ConfigProperty(name = "gcsp.mail.public-base-url")
    Optional<String> publicBaseUrl;

    private NotificationDispatcher dispatcher;

    public boolean available() {
        return persistence.active();
    }

    public AgroalDataSource dataSource() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        return sources.get();
    }

    public TransactionRunner runner() {
        return persistence.runner();
    }

    /** The active run, scoped to an actor; the request never chooses the environment or the run. */
    public RunContext scope(String actorId) {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), actorId);
    }

    /** Built once, on first use. */
    public synchronized NotificationDispatcher dispatcher() {
        if (dispatcher == null) {
            // Offer facts are bound by the Java offer Story; until then every delivery retries as unavailable.
            dispatcher = new NotificationDispatcher(dataSource(), new PolicyDeliveryRules(policy),
                    new UnconfiguredOfferFacts(), transports.transport(), InstantSource.system(),
                    environmentId.orElse(""), publicBaseUrl.filter(url -> !url.isBlank()));
        }
        return dispatcher;
    }
}
