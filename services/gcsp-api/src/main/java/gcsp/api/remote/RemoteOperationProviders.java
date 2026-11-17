package gcsp.api.remote;

import gcsp.api.allocation.HttpRemoteBuddy;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.claims.ClaimStockPort;
import gcsp.api.claims.HttpClaimStock;
import gcsp.api.claims.LocalClaimStock;
import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import java.time.Duration;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Chooses claim stock and Buddy once at startup (FUCQ-481), replacing the local @DefaultBean ports. An unknown name
 * or unusable remote settings stop startup; remote never falls back to local, and nothing calls the network here.
 */
@ApplicationScoped
@Startup
public class RemoteOperationProviders {

    public static final String LOCAL = "local";
    public static final String LOCAL_SYNTHETIC = "local-synthetic";
    public static final String REMOTE = "remote";
    static final String STOCK = "gcsp.claims.stock";
    static final String BUDDY = "gcsp.buddy";
    private static final Logger LOG = Logger.getLogger(RemoteOperationProviders.class);

    @ConfigProperty(name = STOCK + ".provider", defaultValue = LOCAL)
    String stockProvider;
    @ConfigProperty(name = STOCK + ".execute-url")
    Optional<String> stockExecute;
    @ConfigProperty(name = STOCK + ".reconcile-url")
    Optional<String> stockReconcile;
    @ConfigProperty(name = STOCK + ".token")
    Optional<String> stockToken;
    @ConfigProperty(name = STOCK + ".timeout", defaultValue = "10s")
    Duration stockTimeout;

    @ConfigProperty(name = BUDDY + ".provider", defaultValue = LOCAL_SYNTHETIC)
    String buddyProvider;
    @ConfigProperty(name = BUDDY + ".execute-url")
    Optional<String> buddyExecute;
    @ConfigProperty(name = BUDDY + ".reconcile-url")
    Optional<String> buddyReconcile;
    @ConfigProperty(name = BUDDY + ".token")
    Optional<String> buddyToken;
    @ConfigProperty(name = BUDDY + ".timeout", defaultValue = "10s")
    Duration buddyTimeout;

    private ClaimStockPort stock;
    private RemoteBuddy buddy;

    @PostConstruct
    void init() {
        boolean loopback = LaunchMode.current() == LaunchMode.TEST;
        stock = claimStock(stockProvider, stockExecute, stockReconcile, stockToken, stockTimeout, loopback);
        buddy = remoteBuddy(buddyProvider, buddyExecute, buddyReconcile, buddyToken, buddyTimeout, loopback);
        LOG.infof("GCSP claim stock provider: %s; Buddy provider: %s", stock.mode(), buddy.mode());
    }

    @Produces
    @ApplicationScoped
    ClaimStockPort claimStockPort() {
        return stock;
    }

    @Produces
    @ApplicationScoped
    RemoteBuddy remoteBuddyPort() {
        return buddy;
    }

    /** local (the default) or remote; anything else stops startup. Static so every refusal is unit-testable. */
    public static ClaimStockPort claimStock(String provider, Optional<String> execute, Optional<String> reconcile,
            Optional<String> token, Duration timeout, boolean loopbackHttpAllowed) {
        String name = normalise(STOCK, provider, LOCAL, LOCAL);
        if (LOCAL.equals(name)) return new LocalClaimStock();
        return new HttpClaimStock(transport(STOCK, execute, reconcile, token, timeout, loopbackHttpAllowed));
    }

    /** local-synthetic (the default) or remote; anything else stops startup. */
    public static RemoteBuddy remoteBuddy(String provider, Optional<String> execute, Optional<String> reconcile,
            Optional<String> token, Duration timeout, boolean loopbackHttpAllowed) {
        String name = normalise(BUDDY, provider, LOCAL_SYNTHETIC, LOCAL_SYNTHETIC);
        if (LOCAL_SYNTHETIC.equals(name)) return new LocalSyntheticBuddy();
        return new HttpRemoteBuddy(transport(BUDDY, execute, reconcile, token, timeout, loopbackHttpAllowed));
    }

    private static String normalise(String prefix, String provider, String fallback, String local) {
        String n = provider == null || provider.isBlank() ? fallback : provider.trim();
        if (!local.equals(n) && !REMOTE.equals(n)) {
            throw new IllegalStateException("Unknown " + prefix + ".provider '" + n + "'; supported: " + local + ", " + REMOTE);
        }
        return n;
    }

    private static OperationHttpTransport transport(String prefix, Optional<String> execute, Optional<String> reconcile,
            Optional<String> token, Duration timeout, boolean loopbackHttpAllowed) {
        OperationHttpTransport.Settings s = OperationHttpTransport.Settings.parse(prefix, execute, reconcile, token, timeout,
                loopbackHttpAllowed);
        LOG.infof("GCSP %s remote: %s", prefix, s);
        return new OperationHttpTransport(s, OperationHttpTransport.newClient(s.timeout()));
    }
}
