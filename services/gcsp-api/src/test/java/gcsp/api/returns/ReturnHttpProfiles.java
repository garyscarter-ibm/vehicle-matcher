package gcsp.api.returns;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** OIDC identities (two employees, Greg, the presenter) over the native test database and test-only ports. */
public final class ReturnHttpProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private ReturnHttpProfiles() {}

    static Map<String, String> config(String provider) {
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
        m.put("gcsp.returns.provider", provider);
        m.put("gcsp.returns.policy-file", Path.of("src/test/resources/returns/policy.json").toAbsolutePath().toString());
        if (URL != null && !URL.isBlank()) {
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
            return Set.of(ReturnHttpPorts.Source.class, ReturnHttpPorts.Handover.class);
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** The synthetic provider: a request is acknowledged and the confirm waits for a tick. */
    public static class Synthetic extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("synthetic");
        }
    }

    /** The live-stub provider: every write is refused as unsupported. */
    public static class LiveStub extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("live-stub");
        }
    }

    /** No database and no provider, with a fixed-test employee so the request reaches the service. */
    public static class NoDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> m = config("none");
            m.put("gcsp.identity.provider", "fixed-test");
            m.put("gcsp.identity.fixed-test.token", "returns-token");
            m.put("gcsp.identity.fixed-test.subject", "returns-subject");
            m.put("gcsp.identity.fixed-test.roles", "employee");
            m.put("gcsp.identity.fixed-test.employee-id", "E-1001");
            m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
            m.put("gcsp.identity.fixed-test.run-id", "run-1");
            m.put("gcsp.identity.fixed-test.policy-version", "test-policy-1");
            m.put("gcsp.identity.fixed-test.capabilities", "account:read");
            m.put("quarkus.datasource.active", "false");
            m.put("quarkus.flyway.active", "false");
            m.remove("gcsp.environment-id");
            m.remove("gcsp.database.expected-name");
            return m;
        }
    }
}
