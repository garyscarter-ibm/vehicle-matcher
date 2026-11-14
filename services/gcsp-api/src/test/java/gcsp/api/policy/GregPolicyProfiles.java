package gcsp.api.policy;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** oidc identity for greg, employee and presenter; one profile with its own migrated schema, one with no database. */
public final class GregPolicyProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final String ENV = "policy-http-env";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** Unique per JVM; dropped by the test class when it finishes. */
    static final String SCHEMA = "gcsp_p_http_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private GregPolicyProfiles() {
    }

    static org.postgresql.ds.PGSimpleDataSource plain() throws java.sql.SQLException {
        org.postgresql.ds.PGSimpleDataSource ds = new org.postgresql.ds.PGSimpleDataSource();
        ds.setUrl(URL);
        return ds;
    }

    static Map<String, String> identity() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", ENV);
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        return c;
    }

    /** Persistence on, in the throwaway schema; without GCSP_TEST_DATABASE_URL the database stays off and tests skip. */
    public static class Persisted implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = identity();
            if (URL == null || URL.isBlank()) {
                return off(c);
            }
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
            return c;
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** Persistence off: the file policy source, read-only. */
    public static class NoDatabase implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return off(identity());
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    private static Map<String, String> off(Map<String, String> c) {
        c.put("quarkus.datasource.active", "false");
        c.put("quarkus.flyway.active", "false");
        return c;
    }
}
