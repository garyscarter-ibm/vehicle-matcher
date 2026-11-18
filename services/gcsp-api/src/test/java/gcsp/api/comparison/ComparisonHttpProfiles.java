package gcsp.api.comparison;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** OIDC identities (employee, Greg, presenter) over the native test database, or none. */
public final class ComparisonHttpProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private ComparisonHttpProfiles() {}

    /** The database named in the JDBC URL, so the guard accepts a per-story database on a shared cluster. */
    static String databaseName(String url) {
        String path = url.substring(url.lastIndexOf('/') + 1);
        int query = path.indexOf('?');
        return query < 0 ? path : path.substring(0, query);
    }

    static Map<String, String> config(boolean database) {
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
        if (database && URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            m.put("quarkus.flyway.schemas", "gcsp_app");
            m.put("gcsp.environment-id", "test-app-env");
            m.put("gcsp.database.expected-name", databaseName(URL));
        } else {
            m.put("quarkus.datasource.active", "false");
            m.put("quarkus.flyway.active", "false");
        }
        return m;
    }

    abstract static class Base implements QuarkusTestProfile {
        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** The native test database, with the bundled retained result imported at startup. */
    public static class WithDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(true);
        }
    }

    /** No database: reads answer 503 persistence-not-configured. */
    public static class NoDatabase extends Base {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(false);
        }
    }
}
