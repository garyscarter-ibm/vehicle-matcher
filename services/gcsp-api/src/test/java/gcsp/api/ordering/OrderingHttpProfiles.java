package gcsp.api.ordering;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** The Quarkus profiles of the ordering HTTP tests: a fixed principal, test slot, cart converter and policy clock. */
public final class OrderingHttpProfiles {

    static final String TOKEN = "ordering-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String OWNER = "emp-ord-http";
    static final String ENV = "test-app-env";
    static final String RUN = "run-1";
    static final String VERSION = "gcsp-policy-v1";

    private OrderingHttpProfiles() {}

    static Map<String, String> config(String roles, String employeeId, String provider, boolean database) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "ordering-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", ENV);
        m.put("gcsp.identity.fixed-test.run-id", RUN);
        if (employeeId != null) m.put("gcsp.identity.fixed-test.employee-id", employeeId);
        m.put("gcsp.identity.fixed-test.policy-version", VERSION);
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        m.put("gcsp.ordering.provider", provider);
        m.put("gcsp.approvals.policy-file", "../../server/gcsp/policy/seed-v1.json");
        if (database && URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            m.put("quarkus.flyway.schemas", "gcsp_app");
            m.put("gcsp.environment-id", ENV);
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
            return Set.of(OrderingHttpPorts.TestSlots.class, OrderingHttpPorts.Cart.class, OrderingHttpPorts.Clock.class);
        }
    }

    /** One employee with the synthetic provider over the native test database. */
    public static class Employee extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", OWNER, "synthetic", true);
        }
    }

    /** Employee and presenter with the synthetic provider and NO cart converter, so the default is in force. */
    public static class Unbound implements QuarkusTestProfile {
        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(OrderingHttpPorts.TestSlots.class, OrderingHttpPorts.Clock.class);
        }

        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee,presenter", OWNER, "synthetic", true);
        }
    }

    /** One employee with provider none: submit is refused, reads work. */
    public static class ProviderNone extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", OWNER, "none", true);
        }
    }

    /** Employee and presenter with no database. */
    public static class NoDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee,presenter", OWNER, "synthetic", false);
        }
    }
}
