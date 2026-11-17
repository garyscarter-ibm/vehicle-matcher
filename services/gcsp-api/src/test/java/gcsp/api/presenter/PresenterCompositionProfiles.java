package gcsp.api.presenter;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * A configured non-demo composition (hr-snapshot account, synthetic ordering, scenario none, reset off). Both profiles
 * share one schema, so the app restarts between the two classes over the same data.
 */
public final class PresenterCompositionProfiles {

    static final String ENV = PresenterClockProfiles.ENV;
    static final String RUN = "run-1";
    /** One name per JVM: the schema constant of a class would differ between Quarkus class loaders. */
    static final String SCHEMA = String.valueOf(System.getProperties().computeIfAbsent("gcsp.test.ac2.schema",
            k -> "gcsp_s_pclock_ac2_" + Long.toHexString(System.nanoTime())));
    /** The phase-1 facts for phase 2, as JSON in a JVM-wide property. */
    static final String PHASE1 = "gcsp.test.ac2.phase1";
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"" + PresenterCompositionHr.EMPLOYEE + "\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    private PresenterCompositionProfiles() {}

    static Map<String, String> config() {
        Map<String, String> c = PresenterClockProfiles.config(SCHEMA, "tranche-plan");
        try {
            PresenterCompositionHr.write(ENV, RUN);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.account.provider", "hr-snapshot");
        c.put("gcsp.account.hr-snapshot.path", PresenterCompositionHr.FILE.toString());
        // Test-only knob: pins the account asOf so the draft's collection window does not drift with the calendar.
        c.put("gcsp.account.fixed-now", "2026-11-05T09:00:00.000Z");
        c.put("gcsp.ordering.provider", "synthetic");
        c.put("gcsp.appointments.provider", "synthetic");
        c.put("gcsp.scenario.provider", "none");
        c.put("gcsp.reset-allowed", "false");
        return c;
    }

    /** First start of the composition. */
    public static class Phase1 implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return config();
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
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }
}
