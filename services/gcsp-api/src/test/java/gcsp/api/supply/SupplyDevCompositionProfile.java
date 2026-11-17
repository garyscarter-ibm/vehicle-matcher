package gcsp.api.supply;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The documented dev composition with the real selected supply (demo provider, PolicyService release policy). */
public class SupplyDevCompositionProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String ENV = "supply-dev-env";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA = "gcsp_s_supdev_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"}]";

    @Override
    public Map<String, String> getConfigOverrides() {
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
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.production.provider", "synthetic");
        c.put("gcsp.reset-allowed", "true");
        // The selected producer and PolicyService: no policy file and no tranche-plan file.
        c.put("gcsp.supply.provider", "demo");
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", ENV);
            c.put("gcsp.database.expected-name", databaseName(URL));
        }
        return c;
    }

    /** The database named in the JDBC URL's path, so the guard accepts whichever test database is configured. */
    static String databaseName(String url) {
        String path = url.substring(url.indexOf("//") + 2);
        path = path.substring(path.indexOf('/') + 1);
        int q = path.indexOf('?');
        return q < 0 ? path : path.substring(0, q);
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
