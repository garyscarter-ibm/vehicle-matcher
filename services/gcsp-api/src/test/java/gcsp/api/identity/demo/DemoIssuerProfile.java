package gcsp.api.identity.demo;

import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.net.ServerSocket;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.ds.PGSimpleDataSource;

/** The demo issuer switched on with oidc identity, demo scenario data and a schema of its own, over a loopback issuer. */
public class DemoIssuerProfile implements QuarkusTestProfile {

    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA = "gcsp_s_demoidp_" + Long.toHexString(System.nanoTime());
    static final String CLIENT = "gcsp-web";
    static final String AUDIENCE = "gcsp-api";
    static final String REDIRECT = "http://localhost:4300/gcsp/auth/callback";
    static final String POST_LOGOUT = "http://localhost:4300/gcsp/";

    static boolean databaseConfigured() {
        return URL != null && !URL.isBlank();
    }

    static void dropSchema() throws Exception {
        if (!databaseConfigured()) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(URL);
        try (var c = ds.getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        }
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", DemoSupport.accountsJson(DemoSupport.PEOPLE));
        c.put("gcsp.demo-idp.redirect-uris", REDIRECT);
        c.put("gcsp.demo-idp.post-logout-redirect-uris", POST_LOGOUT);
        c.put("gcsp.environment.id", "demo-idp-env");
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.supply.provider", "none");
        c.put("gcsp.supply.policy-file", java.nio.file.Path.of("src/test/resources/supply/policy.json")
                .toAbsolutePath().toString());
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.reset-allowed", "true");
        if (databaseConfigured()) {
            c.put("gcsp.demo-idp.enabled", "true");
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", "demo-idp-env");
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(Port.class));
    }

    /** Picks a free loopback port and points the test port, the issuer and its JWKS at it. */
    public static class Port implements QuarkusTestResourceLifecycleManager {
        @Override
        public Map<String, String> start() {
            try (ServerSocket s = new ServerSocket(0)) {
                int port = s.getLocalPort();
                String issuer = "http://localhost:" + port + "/demo-idp";
                return Map.of("quarkus.http.test-port", String.valueOf(port), "gcsp.oidc.issuer", issuer,
                        "gcsp.oidc.jwks-uri", issuer + "/jwks");
            } catch (IOException e) {
                throw new IllegalStateException("no free port for the demo issuer test", e);
            }
        }

        @Override
        public void stop() {}
    }
}
