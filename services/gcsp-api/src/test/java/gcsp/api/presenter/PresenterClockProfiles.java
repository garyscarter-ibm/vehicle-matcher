package gcsp.api.presenter;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.ds.PGSimpleDataSource;

/** OIDC accounts, the tranche-plan supply source and a schema of its own, so other profiles' ticks stay untouched. */
public final class PresenterClockProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String ENV = "presenter-clock-env";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** Unique per JVM and per profile; each test class drops its own when it finishes. */
    static final String SCHEMA = "gcsp_s_pclock_" + Long.toHexString(System.nanoTime());
    static final String SCHEMA_NONE = "gcsp_s_pclock_none_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private PresenterClockProfiles() {}

    static PGSimpleDataSource plain() throws java.sql.SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(URL);
        return ds;
    }

    static String abs(String name) {
        return Path.of("src/test/resources/supply/" + name).toAbsolutePath().toString();
    }

    static Map<String, String> config(String schema, String provider) {
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
        c.put("gcsp.supply.provider", provider);
        if (!"none".equals(provider)) c.put("gcsp.supply.tranche-plan-file", abs("tranche-plan.json"));
        c.put("gcsp.supply.policy-file", abs("policy.json"));
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            c.put("quarkus.flyway.schemas", schema);
            c.put("quarkus.flyway.default-schema", schema);
            c.put("gcsp.environment-id", ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return c;
    }

    /** Tranche-plan supply: the bound stock-release handler is registered. */
    public static class WithSupply implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA, "tranche-plan");
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** No supply provider: release-pull is a missing stage. */
    public static class NoSupply implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA_NONE, "none");
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }
}
