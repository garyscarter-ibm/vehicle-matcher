package gcsp.api.returns;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the return provider and policy once at startup; an unknown or unusable setting stops the service. */
@ApplicationScoped
@Startup
public class ReturnSelection {

    public static final String NONE = "none";
    public static final String SYNTHETIC = "synthetic";
    public static final String LIVE_STUB = "live-stub";
    private static final Logger LOG = Logger.getLogger(ReturnSelection.class);

    /** The chosen provider name (none, synthetic or live-stub) and the policy source; policyMode is none or file. */
    public record Selected(String providerName, ReturnPolicyPort policy, String policyMode) {}

    @ConfigProperty(name = "gcsp.returns.provider", defaultValue = NONE)
    String providerName;

    @ConfigProperty(name = "gcsp.returns.policy-file")
    Optional<String> policyFile;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile Selected selected;
    private volatile ReturnProviderPort provider;
    private volatile ReturnClock clock;
    private volatile CurrentCarPort currentCar;

    @PostConstruct
    void init() {
        selected = select(providerName, policyFile.orElse(null));
        LOG.infof("GCSP returns provider: %s, policy: %s", selected.providerName(), selected.policyMode());
    }

    public ReturnPolicyPort policy() {
        return selected.policy();
    }

    public String policyMode() {
        return selected.policyMode();
    }

    /** none, synthetic or live-stub as configured; the provider's own mode() is what a response reports. */
    public String providerName() {
        return selected.providerName();
    }

    /** The selected provider; synthetic without persistence has nowhere to receipt, so it is unavailable. */
    public synchronized ReturnProviderPort provider() {
        if (provider == null) provider = provider(selected.providerName(), this::dataSource);
        return provider;
    }

    public synchronized ReturnClock clock() {
        if (clock == null) clock = new TickReturnClock(dataSource());
        return clock;
    }

    public synchronized CurrentCarPort currentCar() {
        if (currentCar == null) currentCar = new CurrentCarStore(dataSource());
        return currentCar;
    }

    private DataSource dataSource() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        return dataSource.get();
    }

    /** Pure selection rule, static so every refusal is unit-testable without a server. */
    public static Selected select(String provider, String policyFile) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        if (!NONE.equals(name) && !SYNTHETIC.equals(name) && !LIVE_STUB.equals(name)) {
            throw new IllegalStateException("Unknown gcsp.returns.provider '" + name + "'; supported: " + NONE + ", "
                    + SYNTHETIC + ", " + LIVE_STUB);
        }
        if (policyFile == null || policyFile.isBlank()) return new Selected(name, new UnconfiguredReturnPolicy(), NONE);
        Path file = Path.of(policyFile.trim());
        if (!Files.isRegularFile(file) || !Files.isReadable(file)) {
            throw new IllegalStateException("gcsp.returns.policy-file is set but cannot be read: " + file);
        }
        return new Selected(name, new RetainedReturnPolicy(file), "file");
    }

    /** The provider for a selected name; synthetic needs a database, so without one it answers unavailable. */
    static ReturnProviderPort provider(String name, Supplier<DataSource> dataSource) {
        switch (name) {
            case SYNTHETIC:
                try {
                    return new SyntheticReturnProvider(dataSource.get());
                } catch (IllegalStateException e) {
                    return new UnconfiguredReturnProvider();
                }
            case LIVE_STUB:
                return new LiveReturnProviderStub();
            default:
                return new UnconfiguredReturnProvider();
        }
    }
}
