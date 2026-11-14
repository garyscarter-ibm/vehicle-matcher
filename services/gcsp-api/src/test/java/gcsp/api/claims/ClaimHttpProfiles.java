package gcsp.api.claims;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Fixed-test identity profiles for the claims HTTP tests; the sweep is paused so ticks never touch a test's rows. */
public final class ClaimHttpProfiles {

    static final String TOKEN = "claims-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String VERSION = "gcsp-policy-v1";
    static final String EMPLOYEE = "emp-claims-http";

    private ClaimHttpProfiles() {}

    static Map<String, String> config(String roles, String employeeId, boolean database) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "claims-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        if (employeeId != null) m.put("gcsp.identity.fixed-test.employee-id", employeeId);
        m.put("gcsp.identity.fixed-test.policy-version", VERSION);
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        m.put("gcsp.claims.sweep-interval", "10m");
        m.put("gcsp.notify.drain-interval", "10m");
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

    /** An employee with the shipped defaults: selection unconfigured. */
    public static class Unconfigured implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", "emp-claims-none", true);
        }
    }

    /** An employee with a selection port that finds one eligible car, a fixed timing and the default clock. */
    public static class Selecting implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", EMPLOYEE, true);
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(ClaimHttpPorts.Selection.class, ClaimHttpPorts.Timing.class);
        }
    }

    /** A presenter: every claims route refuses the role. */
    public static class Presenter implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("presenter", null, true);
        }
    }

    /** An employee with no database. */
    public static class NoDatabase implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", EMPLOYEE, false);
        }
    }
}
