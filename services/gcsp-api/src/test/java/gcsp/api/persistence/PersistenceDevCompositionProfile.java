package gcsp.api.persistence;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The documented dev composition over its own schema in the dev database: no test alternatives are enabled. */
public class PersistenceDevCompositionProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String ENV = "persistence-dev-env";
    static final String RUN = "run-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA = "gcsp_s_pdev_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"}]";

    /** The shared OIDC, provider and datasource settings; url may be null, which leaves persistence off. */
    static Map<String, String> base(String url, String schema, String env) {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", env);
        c.put("gcsp.environment.run-id", RUN);
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.supply.provider", "demo");
        c.put("gcsp.allocation.candidates.provider", "recommendation");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.production.provider", "synthetic");
        c.put("gcsp.approvals.provider", "synthetic");
        c.put("gcsp.documents.provider", "synthetic");
        c.put("gcsp.appointments.provider", "synthetic");
        c.put("gcsp.returns.provider", "synthetic");
        // Global test alternatives that would otherwise replace the real offers, documents and clock beans.
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,gcsp.api.documents.DocumentsTestPorts$Policy,"
                + "gcsp.api.documents.DocumentsTestPorts$Cases,gcsp.api.documents.DocumentsTestPorts$Clock");
        if (url != null && !url.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", url);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            c.put("quarkus.flyway.schemas", schema);
            c.put("quarkus.flyway.default-schema", schema);
            c.put("gcsp.environment-id", env);
            c.put("gcsp.database.expected-name", databaseName(url));
        }
        return c;
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = base(URL, SCHEMA, ENV);
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.reset-allowed", "true");
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
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
