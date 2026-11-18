package gcsp.api.auth;

import gcsp.api.JwksServerResource;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.postgresql.ds.PGSimpleDataSource;

/** The broad demo composition over real OIDC and native PostgreSQL, shared by the route-table and token-journey tests. */
public class AuthRouteTableProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** One name per JVM: a profile constant can differ between Quarkus class loaders. */
    static final String SCHEMA = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.auth-routes.schema",
            k -> "gcsp_s_auth_routes_" + Long.toHexString(System.nanoTime())));
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"},"
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]},"
            + "{\"subject\":\"sub-greg-only\",\"roles\":[\"greg\"]}]";

    static String databaseName(String url) {
        String path = url.substring(url.lastIndexOf('/') + 1);
        int q = path.indexOf('?');
        return q < 0 ? path : path.substring(0, q);
    }

    private static String abs(String relative) {
        return Path.of("src/test/resources/" + relative).toAbsolutePath().toString();
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", "auth-routes-env");
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.supply.provider", "tranche-plan");
        c.put("gcsp.supply.tranche-plan-file", abs("supply/tranche-plan.json"));
        c.put("gcsp.supply.policy-file", abs("supply/policy.json"));
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.reset-allowed", "true");
        c.put("gcsp.appointments.provider", "synthetic");
        c.put("gcsp.returns.provider", "synthetic");
        c.put("gcsp.returns.policy-file", abs("returns/policy.json"));
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", "auth-routes-env");
            c.put("gcsp.database.expected-name", databaseName(URL));
        }
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,"
                + "gcsp.api.documents.DocumentsTestPorts$Policy,gcsp.api.documents.DocumentsTestPorts$Cases,"
                + "gcsp.api.documents.DocumentsTestPorts$Clock");
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class), new TestResourceEntry(DropSchema.class));
    }

    /** Drops the profile's schema when the app stops, so the two test classes can share it. */
    public static class DropSchema implements QuarkusTestResourceLifecycleManager {
        @Override
        public Map<String, String> start() {
            return Map.of();
        }

        @Override
        public void stop() {
            if (URL == null || URL.isBlank() || !SCHEMA.startsWith("gcsp_s_auth_routes_")) return;
            PGSimpleDataSource ds = new PGSimpleDataSource();
            ds.setUrl(URL);
            try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
                st.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException("schema cleanup failed", e);
            }
        }
    }
}
