package gcsp.api.cases;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The started composition for the case journey: OIDC, repository accounts, demo scenario, real case ports, own schema. */
public final class CaseCompositionProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** Unique per JVM; the journey test drops it when it finishes. */
    static final String SCHEMA = "gcsp_s_casejny_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    static String abs(String name) {
        return Path.of("src/test/resources/supply/" + name).toAbsolutePath().toString();
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", "gcsp-api");
        c.put("gcsp.oidc.authorized-party", "gcsp-web");
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", "case-journey-env");
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.reset-allowed", "true");
        c.put("gcsp.supply.provider", "tranche-plan");
        c.put("gcsp.supply.tranche-plan-file", abs("tranche-plan.json"));
        c.put("gcsp.supply.policy-file", abs("policy.json"));
        c.put("gcsp.mail.transport", "");
        c.put("gcsp.claims.sweep-interval", "10m");
        c.put("gcsp.notify.drain-interval", "10m");
        // Other suites' global test alternatives must not replace the real beans the journey proves.
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,"
                + "gcsp.api.documents.DocumentsTestPorts$Policy,gcsp.api.documents.DocumentsTestPorts$Cases,"
                + "gcsp.api.documents.DocumentsTestPorts$Clock");
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", "case-journey-env");
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
