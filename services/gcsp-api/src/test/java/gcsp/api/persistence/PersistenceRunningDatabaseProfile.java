package gcsp.api.persistence;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The running composition: environment gcsp-poc on the running database, reset not allowed, scenarios none. */
public class PersistenceRunningDatabaseProfile implements QuarkusTestProfile {

    static final String ENV = "gcsp-poc";
    static final String URL = System.getenv("GCSP_TEST_RUNNING_DATABASE_URL");
    static final String SCHEMA = "gcsp_s_prun_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = PersistenceDevCompositionProfile.base(URL, SCHEMA, ENV);
        c.put("gcsp.scenario.provider", "none");
        c.put("gcsp.reset-allowed", "false");
        return c;
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
