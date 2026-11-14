package gcsp.api.brief;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** The three Quarkus profiles of the brief HTTP tests; each fixes the principal and enables the test ports. */
public final class BriefHttpProfiles {

    static final String TOKEN = "brief-token";
    static final String UNMAPPED = "brief-unmapped-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** Unique per JVM so reruns never collide with rows kept by earlier runs of the shared database. */
    static final String EMPLOYEE = "emp-http-" + Long.toHexString(System.nanoTime());

    private BriefHttpProfiles() {}

    static Map<String, String> identity(String roles, String employeeId) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.unmapped-token", UNMAPPED);
        m.put("gcsp.identity.fixed-test.subject", "brief-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        if (employeeId != null) m.put("gcsp.identity.fixed-test.employee-id", employeeId);
        m.put("gcsp.identity.fixed-test.policy-version", "gcsp-policy-v1");
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        return m;
    }

    static Map<String, String> noDatabase(Map<String, String> m) {
        m.put("quarkus.datasource.active", "false");
        m.put("quarkus.flyway.active", "false");
        return m;
    }

    static Set<Class<?>> ports() {
        return Set.of(BriefHttpPorts.SeedPolicy.class, BriefHttpPorts.CurrentCar.class);
    }

    /** An employee with the shared test database (the same environment and first run as PersistenceWiringTest). */
    public static class Persisted implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> m = identity("employee", EMPLOYEE);
            if (URL == null || URL.isBlank()) return noDatabase(m);
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            m.put("quarkus.flyway.schemas", "gcsp_app");
            m.put("gcsp.environment-id", "test-app-env");
            m.put("gcsp.database.expected-name", "gcsp_test_dev");
            return m;
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return ports();
        }
    }

    /** An employee with persistence switched off. */
    public static class NoDatabase implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return noDatabase(identity("employee", EMPLOYEE));
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return ports();
        }
    }

    /** A principal that holds only the presenter role. */
    public static class Presenter implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return noDatabase(identity("presenter", null));
        }
    }
}
