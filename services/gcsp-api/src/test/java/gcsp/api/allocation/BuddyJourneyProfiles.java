package gcsp.api.allocation;

import gcsp.api.JwksServerResource;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import io.quarkus.test.junit.QuarkusTestProfile;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The started composition for the Buddy journeys: OIDC, repository accounts, tranche-plan supply, real candidates. */
public final class BuddyJourneyProfiles {

    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-carla\",\"roles\":[\"employee\"],\"employeeId\":\"employee-carla\"},"
            + "{\"subject\":\"sub-bruno\",\"roles\":[\"employee\"],\"employeeId\":\"employee-bruno\"},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private BuddyJourneyProfiles() {}

    public static Map<String, String> config(String buddy) {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", "https://issuer.test/realms/gcsp");
        c.put("gcsp.oidc.audience", "gcsp-api");
        c.put("gcsp.oidc.authorized-party", "gcsp-web");
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", BuddyJourneySeed.ENV);
        c.put("gcsp.environment.run-id", BuddyJourneySeed.RUN);
        c.put("gcsp.environment.policy-version", BuddyJourneySeed.POLICY);
        c.put("gcsp.environment-id", BuddyJourneySeed.ENV);
        c.put("gcsp.database.expected-name", "gcsp_test_dev");
        c.put("gcsp.reset-allowed", "true");
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.buddy.provider", buddy);
        c.put("gcsp.claims.stock.provider", "local");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.scenario.provider", "none");
        c.put("gcsp.supply.provider", "tranche-plan");
        c.put("gcsp.supply.policy-file", Path.of("src/test/resources/supply/policy.json").toAbsolutePath().toString());
        c.put("gcsp.allocation.candidates.provider", "recommendation");
        c.put("gcsp.mail.transport", "");
        c.put("gcsp.mail.public-base-url", "https://gcsp.example.test");
        c.put("gcsp.claims.sweep-interval", "10m");
        c.put("gcsp.notify.drain-interval", "10m");
        // The offers HTTP test's global in-memory records alternative must not replace the PostgreSQL reader here.
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records");
        return c;
    }

    /** Local-synthetic Buddy: claims are immediate. */
    public static class Local implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("local-synthetic");
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(RunClockPolicyClock.class);
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class),
                    new TestResourceEntry(BuddyJourneyResource.class, Map.of("mode", "local")));
        }
    }

    /** Remote Buddy over a scripted loopback server. */
    public static class Remote implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("remote");
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(RunClockPolicyClock.class);
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class),
                    new TestResourceEntry(BuddyJourneyResource.class, Map.of("mode", "remote")));
        }
    }

    /** Offers read their time from this binding; the app has no run-clock PolicyClock, so the test supplies one. */
    @Alternative
    @ApplicationScoped
    public static class RunClockPolicyClock implements PolicyClock {
        @Inject
        RunClockHolder holder;

        @Override
        public Instant now(RunContext context) {
            try {
                return holder.clock().now(context.environmentId(), context.runId()).map(ClockReading::now)
                        .orElseGet(Instant::now);
            } catch (RuntimeException e) {
                return Instant.now();
            }
        }
    }
}
