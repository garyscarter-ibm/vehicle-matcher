package gcsp.api.approvals;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** The four Quarkus profiles of the approvals HTTP tests; each fixes one principal and uses the in-memory order source. */
public final class ApprovalHttpProfiles {

    static final String TOKEN = "approvals-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String OWNER = "emp-http-owner";
    static final String POLICY = "../../server/gcsp/policy/seed-v1.json";

    private ApprovalHttpProfiles() {}

    static Map<String, String> config(String roles, String employeeId, String provider, boolean database) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "approvals-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        if (employeeId != null) m.put("gcsp.identity.fixed-test.employee-id", employeeId);
        m.put("gcsp.identity.fixed-test.policy-version", "gcsp-policy-v1");
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        m.put("gcsp.approvals.provider", provider);
        m.put("gcsp.approvals.policy-file", POLICY);
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
            return Set.of(ApprovalHttpPorts.Orders.class);
        }
    }

    /** The presenter, with the synthetic ordering scenario over the native test database. */
    public static class Presenter extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("presenter", null, "synthetic", true);
        }
    }

    /** One employee, with the synthetic scenario. */
    public static class Employee extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("employee", OWNER, "synthetic", true);
        }
    }

    /** Greg, with provider none: the tick can never approve anything. */
    public static class GregNone extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("greg", null, "none", true);
        }
    }

    /** The presenter with no database and no provider. */
    public static class NoDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config("presenter", null, "none", false);
        }
    }
}
