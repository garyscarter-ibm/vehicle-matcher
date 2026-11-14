package gcsp.api.production;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the Production provider once at startup; an unknown setting stops the service. */
@ApplicationScoped
@Startup
public class ProductionSelection {

    public static final String NONE = "none";
    public static final String SYNTHETIC = "synthetic";
    public static final String LIVE_STUB = "live-stub";
    private static final Logger LOG = Logger.getLogger(ProductionSelection.class);

    @ConfigProperty(name = "gcsp.production.provider", defaultValue = NONE)
    String providerName;

    private volatile String selected;

    @PostConstruct
    void init() {
        selected = select(providerName);
        LOG.infof("GCSP production provider: %s", selected);
    }

    /** none, synthetic or live-stub as configured. */
    public String providerName() {
        return selected;
    }

    /** Pure selection rule, static so every refusal is unit-testable without a server. */
    public static String select(String provider) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        if (!NONE.equals(name) && !SYNTHETIC.equals(name) && !LIVE_STUB.equals(name)) {
            throw new IllegalStateException("Unknown gcsp.production.provider '" + name + "'; supported: " + NONE + ", "
                    + SYNTHETIC + ", " + LIVE_STUB);
        }
        return name;
    }

    /** The provider for a selected name; synthetic needs a database, so without one it answers unavailable. */
    static ProductionProviderPort provider(String name, Supplier<DataSource> dataSource) {
        switch (name) {
            case SYNTHETIC:
                try {
                    return new SyntheticProductionProvider(dataSource.get());
                } catch (IllegalStateException e) {
                    return new UnconfiguredProductionProvider();
                }
            case LIVE_STUB:
                return new LiveProductionProviderStub();
            default:
                return new UnconfiguredProductionProvider();
        }
    }
}
