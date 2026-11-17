package gcsp.api.production;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** OIDC identities (employee, Greg, the presenter) over the native test database, a movable plan port and a release policy. */
public final class ProductionHttpProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private ProductionHttpProfiles() {}

    static Map<String, String> config(String provider, boolean database) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "oidc");
        m.put("gcsp.oidc.issuer", ISSUER);
        m.put("gcsp.oidc.audience", AUDIENCE);
        m.put("gcsp.oidc.authorized-party", CLIENT);
        m.put("gcsp.oidc.required-scopes", "gcsp-api");
        m.put("gcsp.oidc.accounts", ACCOUNTS);
        m.put("gcsp.environment.id", "test-app-env");
        m.put("gcsp.environment.run-id", "run-1");
        m.put("gcsp.environment.policy-version", "test-policy-1");
        m.put("gcsp.production.provider", provider);
        m.put("gcsp.supply.policy-file", Path.of("src/test/resources/supply/policy.json").toAbsolutePath().toString());
        if (database && URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            m.put("quarkus.flyway.schemas", "gcsp_app");
            m.put("gcsp.environment-id", "test-app-env");
            m.put("gcsp.database.expected-name", "gcsp_test_dev");
        } else {
            m.put("quarkus.datasource.active", "false");
            m.put("quarkus.flyway.active", "false");
        }
        return m;
    }

    abstract static class Base implements QuarkusTestProfile {
        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(ProductionHttpPorts.Plan.class);
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** The synthetic provider: requests are stored once and the presenter scripts the answers. */
    public static class Synthetic extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("synthetic", true);
        }
    }

    /** The live-stub provider: every line is refused as unsupported and nothing is sent. */
    public static class LiveStub extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("live-stub", true);
        }
    }

    /** No provider selected: submission is unavailable. */
    public static class None extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("none", true);
        }
    }

    /** No database: Greg is a fixed-test identity so the request reaches the service. */
    public static class NoDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> m = config("synthetic", false);
            m.put("gcsp.identity.provider", "fixed-test");
            m.put("gcsp.identity.fixed-test.token", "production-token");
            m.put("gcsp.identity.fixed-test.subject", "production-subject");
            m.put("gcsp.identity.fixed-test.roles", "greg");
            m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
            m.put("gcsp.identity.fixed-test.run-id", "run-1");
            m.put("gcsp.identity.fixed-test.policy-version", "test-policy-1");
            m.put("gcsp.identity.fixed-test.capabilities", "greg:read");
            m.remove("gcsp.environment-id");
            m.remove("gcsp.database.expected-name");
            return m;
        }
    }

    /** The real plan port and the real order-plan history over a private schema; only the planner's inputs are test beans. */
    public static class Journey extends Base {
        static final String SCHEMA = "gcsp_s_prodplan_" + Long.toHexString(System.nanoTime());

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(ProductionPlanPorts.Inputs.class, ProductionPlanPorts.FixedClock.class);
        }

        @Override
        public Map<String, String> getConfigOverrides() {
            return planConfig(SCHEMA);
        }
    }

    /** The started app's own composition: no test alternative at all. */
    public static class Composition extends Base {
        static final String SCHEMA = "gcsp_s_prodcomp_" + Long.toHexString(System.nanoTime());

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of();
        }

        @Override
        public Map<String, String> getConfigOverrides() {
            return planConfig(SCHEMA);
        }
    }

    /** Synthetic provider, the seed policy version (it carries the order-plan catalogue) and a private schema. */
    static Map<String, String> planConfig(String schema) {
        Map<String, String> m = config("synthetic", true);
        m.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        if (URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            m.put("quarkus.flyway.schemas", schema);
            m.put("quarkus.flyway.default-schema", schema);
        }
        return m;
    }
}
