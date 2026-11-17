package gcsp.api.ordering;

import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Settings;
import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Optional;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * The ordering provider composition bridge (FUCQ-481): none and synthetic delegate to the unchanged
 * OrderingProviderSelection; remote is one HttpOrderingProvider validated and built at startup without a network call.
 */
@ApplicationScoped
@Startup
public class OrderingProviderBindings {

    public static final String REMOTE = "remote";
    static final String PREFIX = "gcsp.ordering";
    private static final Logger LOG = Logger.getLogger(OrderingProviderBindings.class);

    @Inject
    OrderingSelection selection;

    @ConfigProperty(name = PREFIX + ".execute-url")
    Optional<String> executeUrl;
    @ConfigProperty(name = PREFIX + ".reconcile-url")
    Optional<String> reconcileUrl;
    @ConfigProperty(name = PREFIX + ".token")
    Optional<String> token;
    @ConfigProperty(name = PREFIX + ".timeout", defaultValue = "10s")
    Duration timeout;

    private volatile Binding binding;

    @PostConstruct
    void init() {
        binding = configure(selection.provider(), executeUrl, reconcileUrl, token, timeout,
                LaunchMode.current() == LaunchMode.TEST);
        // Mode only: endpoints and the token never reach a log line.
        LOG.infof("GCSP ordering provider binding: %s", binding.mode());
    }

    /** What OrderingServiceHolder passes to OrderingService; the caller's datasource is used by synthetic only. */
    public OrderingProviderPort provider(DataSource dataSource) {
        return current().provider(dataSource);
    }

    public String mode() {
        return current().mode();
    }

    @PreDestroy
    void close() {
        Binding b = binding;
        if (b != null) b.close();
    }

    private Binding current() {
        Binding b = binding;
        if (b == null) throw new IllegalStateException("The ordering provider binding is not initialised");
        return b;
    }

    /** Blank is none; none, synthetic and remote pass; anything else stops startup. Remote settings are checked eagerly. */
    static Binding configure(String mode, Optional<String> executeUrl, Optional<String> reconcileUrl, Optional<String> token,
            Duration timeout, boolean loopbackHttpAllowed) {
        String n = mode == null || mode.isBlank() ? OrderingSelection.NONE : mode.trim();
        if (OrderingSelection.NONE.equals(n) || OrderingSelection.SYNTHETIC.equals(n)) return new Binding(n, null, null);
        if (!REMOTE.equals(n)) {
            throw new IllegalStateException("Unknown " + PREFIX + ".provider '" + n + "'; supported: "
                    + OrderingSelection.NONE + ", " + OrderingSelection.SYNTHETIC + ", " + REMOTE);
        }
        Settings settings = Settings.parse(PREFIX, executeUrl, reconcileUrl, token, timeout, loopbackHttpAllowed);
        HttpClient client = OperationHttpTransport.newClient(settings.timeout());
        try {
            return new Binding(n, new HttpOrderingProvider(settings, client), client);
        } catch (RuntimeException e) {
            client.shutdownNow();
            throw e;
        }
    }

    /** One startup decision. It owns the remote client, if any; closed, it refuses rather than hand out a dead port. */
    static final class Binding implements AutoCloseable {

        private final String mode;
        private final HttpOrderingProvider remote;
        private final HttpClient client;
        private boolean closed;

        private Binding(String mode, HttpOrderingProvider remote, HttpClient client) {
            this.mode = mode;
            this.remote = remote;
            this.client = client;
        }

        String mode() {
            return mode;
        }

        synchronized OrderingProviderPort provider(DataSource dataSource) {
            if (closed) throw new IllegalStateException("The ordering provider binding is closed");
            return remote != null ? remote : OrderingProviderSelection.select(mode, dataSource);
        }

        Optional<HttpClient> ownedClient() {
            return Optional.ofNullable(client);
        }

        /** shutdownNow, not close: an aborted call is UNKNOWN, which OrderingService keeps pending and reconciles later. */
        @Override
        public synchronized void close() {
            if (closed) return;
            closed = true;
            if (client != null) client.shutdownNow();
        }
    }
}
