package gcsp.api.brief;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The documented dev composition with the real brief ports; both phases share one schema, so the app restarts between them. */
public final class BriefJourneyProfiles {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final String ENV = "brief-journey-env";
    static final String RUN = "run-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    /** One name per JVM: a class constant would differ between Quarkus class loaders. */
    static final String SCHEMA = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.briefj.schema",
            k -> "gcsp_s_briefj_" + Long.toHexString(System.nanoTime())));
    /** The phase-1 facts for phase 2, as JSON in a JVM-wide property. */
    static final String PHASE1 = "gcsp.test.briefj.phase1";
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-jordan\",\"roles\":[\"employee\"],\"employeeId\":\"employee-jordan\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private BriefJourneyProfiles() {}

    static Map<String, String> config() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", ENV);
        c.put("gcsp.environment.run-id", RUN);
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.reset-allowed", "true");
        // The shared test stand-ins are enabled alternatives; the real ports must be the ones that answer.
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,gcsp.api.documents.DocumentsTestPorts$Policy,"
                + "gcsp.api.documents.DocumentsTestPorts$Cases,gcsp.api.documents.DocumentsTestPorts$Clock");
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            c.put("quarkus.flyway.schemas", SCHEMA);
            c.put("quarkus.flyway.default-schema", SCHEMA);
            c.put("gcsp.environment-id", ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return c;
    }

    /** First start of the composition. */
    public static class Phase1 implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config();
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of();
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** The same composition under a distinct profile, so Quarkus restarts the app on the same schema. */
    public static class Phase2 implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config();
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of();
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }
}
