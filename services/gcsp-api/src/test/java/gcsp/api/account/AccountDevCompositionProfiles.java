package gcsp.api.account;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The documented dev composition (persistence, demo seeding, oidc, synthetic ordering) over a schema of its own. */
final class AccountDevCompositionProfiles {

    static final String ENV = "account-dev-env";
    static final String RUN = "run-1";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA_REPOSITORY = "gcsp_s_acctdev_repo_" + Long.toHexString(System.nanoTime());
    static final String SCHEMA_SNAPSHOT = "gcsp_s_acctdev_snap_" + Long.toHexString(System.nanoTime());
    /** The export the started app reads in the hr-snapshot class. */
    static final Path APP_EXPORT = Paths.get("target", "account-dev", "app-hr-export.json").toAbsolutePath();
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-alex\",\"roles\":[\"employee\"],\"employeeId\":\"employee-alex\"},"
            + "{\"subject\":\"sub-sam\",\"roles\":[\"employee\"],\"employeeId\":\"employee-sam\"},"
            + "{\"subject\":\"sub-jordan\",\"roles\":[\"employee\"],\"employeeId\":\"employee-jordan\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]}]";

    private AccountDevCompositionProfiles() {}

    static Map<String, String> config(String schema, String provider) {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", AccountHttpProfile.ISSUER);
        c.put("gcsp.oidc.audience", AccountHttpProfile.AUDIENCE);
        c.put("gcsp.oidc.authorized-party", AccountHttpProfile.CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", ENV);
        c.put("gcsp.environment.run-id", RUN);
        c.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        c.put("gcsp.account.provider", provider);
        c.put("gcsp.scenario.provider", "demo");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.reset-allowed", "true");
        // The only test-only knob: the system clock would make asOf differ between the HTTP and in-process reads.
        c.put("gcsp.account.fixed-now", "2026-11-05T09:00:00.000Z");
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

    /** provider repository: the started app reads the rows demo preparation wrote. */
    public static class Repository implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA_REPOSITORY, "repository");
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** provider hr-snapshot over a placeholder export (rewritten per test); persistence and seeding stay on. */
    public static class Snapshot implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = config(SCHEMA_SNAPSHOT, "hr-snapshot");
            try {
                AccountDevCompositionSupport.writeExport(APP_EXPORT, AccountDevCompositionSupport.slotsFromFile());
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
            c.put("gcsp.account.hr-snapshot.path", APP_EXPORT.toString());
            return c;
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }
}
