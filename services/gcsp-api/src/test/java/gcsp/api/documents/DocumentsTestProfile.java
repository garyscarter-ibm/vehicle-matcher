package gcsp.api.documents;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** OIDC accounts and the native test database together; the principal's run is the one the guard claims. */
public class DocumentsTestProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String ENVIRONMENT = "test-app-env";
    static final String RUN = "run-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", ENVIRONMENT);
        c.put("gcsp.environment.run-id", RUN);
        c.put("gcsp.environment.policy-version", DocumentsPg.VERSION);
        c.put("gcsp.documents.provider", "synthetic");
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            c.put("quarkus.flyway.schemas", "gcsp_app");
            c.put("gcsp.environment-id", ENVIRONMENT);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(gcsp.api.JwksServerResource.class));
    }
}
