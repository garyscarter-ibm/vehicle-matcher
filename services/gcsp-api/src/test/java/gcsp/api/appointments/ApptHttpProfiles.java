package gcsp.api.appointments;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Real-JWT identity, the native test database and the test ports; the subclasses differ in provider or database. */
public class ApptHttpProfiles implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    String provider() {
        return "synthetic";
    }

    boolean database() {
        return true;
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "oidc");
        m.put("gcsp.oidc.issuer", ISSUER);
        m.put("gcsp.oidc.audience", AUDIENCE);
        m.put("gcsp.oidc.authorized-party", CLIENT);
        m.put("gcsp.oidc.required-scopes", "gcsp-api");
        m.put("gcsp.oidc.accounts", ACCOUNTS);
        m.put("gcsp.environment.id", "test-app-env");
        m.put("gcsp.environment.run-id", "run-1");
        m.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        m.put("gcsp.appointments.provider", provider());
        if (database() && URL != null && !URL.isBlank()) {
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

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of(ApptHttpPorts.Stages.class, ApptHttpPorts.Readiness.class);
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }

    /** The synthetic provider over the test database. */
    public static class Synthetic extends ApptHttpProfiles {
    }

    /** The live stub: every provider call is an explicit unsupported answer. */
    public static class Live extends ApptHttpProfiles {
        @Override
        String provider() {
            return "live";
        }
    }

    /** No provider: every read and command is unavailable. */
    public static class None extends ApptHttpProfiles {
        @Override
        String provider() {
            return "none";
        }
    }

    /** Persistence switched off. */
    public static class NoDatabase extends ApptHttpProfiles {
        @Override
        boolean database() {
            return false;
        }
    }
}
