package gcsp.api.identity.demo;

import gcsp.api.persistence.Persistence;
import gcsp.api.scenario.DemoPreparationFile;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import org.eclipse.microprofile.config.Config;
import org.jboss.logging.Logger;

/**
 * Builds the demo sign-in issuer once at startup. Switched off (the default) it touches nothing; switched on in a
 * wrong composition it stops startup with a clear message.
 */
@ApplicationScoped
@Startup
public class DemoIssuer {

    private static final Logger LOG = Logger.getLogger(DemoIssuer.class);

    @Inject
    Config config;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile DemoIssuerSettings settings;
    private volatile DemoSigningKeys keys;
    private volatile DemoTokens tokens;
    private volatile DemoSessions sessions;
    private volatile List<DemoPerson> people = List.of();

    @PostConstruct
    void init() {
        Optional<DemoIssuerSettings> built = DemoIssuerSettings.fromLookup(k -> config.getOptionalValue(k, String.class),
                LaunchMode.current(), persistence.active(), () -> DemoPerson.from(DemoPreparationFile.load()));
        if (built.isEmpty()) {
            return;
        }
        settings = built.get();
        people = DemoPerson.from(DemoPreparationFile.load());
        AgroalDataSource source = dataSource.get();
        keys = DemoSigningKeys.load(source);
        Clock clock = Clock.systemUTC();
        tokens = new DemoTokens(settings, keys, clock);
        sessions = new DemoSessions(source, clock, settings.refreshTokenLifetime());
        LOG.infof("GCSP demo sign-in issuer is ON at %s. Fictional people only.", settings.issuer());
    }

    public boolean enabled() {
        return settings != null;
    }

    public DemoIssuerSettings settings() {
        return require(settings);
    }

    public DemoSigningKeys keys() {
        return require(keys);
    }

    public DemoTokens tokens() {
        return require(tokens);
    }

    public DemoSessions sessions() {
        return require(sessions);
    }

    /** The fictional people the sign-in page lists, from the scenario directory. */
    public List<DemoPerson> people() {
        return people;
    }

    private static <T> T require(T value) {
        if (value == null) {
            throw new IllegalStateException("The demo sign-in issuer is not switched on");
        }
        return value;
    }
}
