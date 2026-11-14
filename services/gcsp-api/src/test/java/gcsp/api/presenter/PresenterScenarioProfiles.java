package gcsp.api.presenter;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;

/** Scenario provider demo or none over schemas of their own (a reset retires runs, so no schema is shared). */
public final class PresenterScenarioProfiles {

    static final String SCHEMA_DEMO = "gcsp_s_pclock_scn_" + Long.toHexString(System.nanoTime());
    static final String SCHEMA_JOURNEY = "gcsp_s_pclock_jny_" + Long.toHexString(System.nanoTime());
    static final String SCHEMA_NONE = "gcsp_s_pclock_scnnone_" + Long.toHexString(System.nanoTime());
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private PresenterScenarioProfiles() {}

    static Map<String, String> config(String schema, String provider) {
        Map<String, String> c = PresenterClockProfiles.config(schema, "none");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.scenario.provider", provider);
        c.put("gcsp.account.provider", "repository");
        c.put("gcsp.reset-allowed", "true");
        return c;
    }

    /** Demo preparation, reset allowed on the dev database. */
    public static class Demo implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA_DEMO, "demo");
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** Demo preparation plus the synthetic tranche-plan supply, for the faults and reset journey. */
    public static class Journey implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = config(SCHEMA_JOURNEY, "demo");
            c.put("gcsp.supply.provider", "tranche-plan");
            c.put("gcsp.supply.tranche-plan-file", PresenterClockProfiles.abs("tranche-plan.json"));
            c.put("gcsp.appointments.provider", "synthetic");
            c.put("gcsp.returns.provider", "synthetic");
            c.put("gcsp.returns.policy-file", java.nio.file.Path.of("src/test/resources/returns/policy.json")
                    .toAbsolutePath().toString());
            return c;
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** The default provider: nothing is seeded. */
    public static class None implements QuarkusTestProfile {
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
