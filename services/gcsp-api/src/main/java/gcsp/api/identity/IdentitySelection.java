package gcsp.api.identity;

import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.Startup;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.Config;
import org.jboss.logging.Logger;

/** Chooses the identity port once at startup; an unknown or disallowed provider stops the service. */
@ApplicationScoped
public class IdentitySelection {

    public static final String NONE = "none";
    public static final String FIXED_TEST = "fixed-test";
    private static final Logger LOG = Logger.getLogger(IdentitySelection.class);

    @Produces
    @Startup
    @ApplicationScoped
    IdentityPort identityPort(Config config) {
        String provider = config.getOptionalValue("gcsp.identity.provider", String.class).orElse(NONE);
        IdentityPort port = select(provider, LaunchMode.current(), config);
        LOG.infof("GCSP identity provider: %s", port.mode());
        return port;
    }

    /** Pure selection rule, kept static so the refusal cases are unit-testable without a server. */
    public static IdentityPort select(String provider, LaunchMode mode, Config config) {
        String name = provider == null ? NONE : provider.trim();
        switch (name) {
            case NONE:
                return new UnconfiguredIdentity();
            case FIXED_TEST:
                if (mode != LaunchMode.TEST) {
                    throw new IllegalStateException(
                            "gcsp.identity.provider=fixed-test is only allowed in automated tests");
                }
                return fixedTest(config);
            default:
                throw new IllegalStateException("Unknown gcsp.identity.provider '" + name
                        + "'; supported: none" + (mode == LaunchMode.TEST ? ", fixed-test" : ""));
        }
    }

    private static IdentityPort fixedTest(Config config) {
        String prefix = "gcsp.identity.fixed-test.";
        java.util.function.Function<String, String> get =
                key -> config.getOptionalValue(prefix + key, String.class).orElse(null);
        Principal principal = new Principal(
                get.apply("subject"),
                FixedTestIdentity.list(get.apply("roles")),
                get.apply("environment-id"),
                get.apply("run-id"),
                get.apply("employee-id"),
                get.apply("policy-version"),
                FixedTestIdentity.list(get.apply("capabilities")));
        return new FixedTestIdentity(get.apply("token"), get.apply("unmapped-token"), principal);
    }
}
