package gcsp.api.ordering;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the ordering provider name once at startup; an unknown value stops the service, never a silent fallback. */
@ApplicationScoped
@Startup
public class OrderingSelection {

    public static final String NONE = "none";
    public static final String SYNTHETIC = "synthetic";
    private static final Logger LOG = Logger.getLogger(OrderingSelection.class);

    @ConfigProperty(name = "gcsp.ordering.provider", defaultValue = NONE)
    String providerName;

    private volatile String provider;

    @PostConstruct
    void init() {
        provider = validate(providerName);
        LOG.infof("GCSP ordering provider: %s", provider);
    }

    public String provider() {
        return provider;
    }

    /** The normalised name, or an IllegalStateException that stops startup. */
    public static String validate(String name) {
        String n = name == null || name.isBlank() ? NONE : name.trim();
        if (!NONE.equals(n) && !SYNTHETIC.equals(n)) {
            throw new IllegalStateException("Unknown gcsp.ordering.provider '" + n + "'; supported: " + NONE + ", " + SYNTHETIC);
        }
        return n;
    }
}
