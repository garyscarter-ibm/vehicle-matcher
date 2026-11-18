package gcsp.api.appointments;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The handover journey: real RS256 identity, a private schema, demo-prepared people and every port real, with no
 * test alternative in force. Only released stock (upstream supply) is seeded by the test.
 */
public class HandoverJourneyProfile implements QuarkusTestProfile {

    /** Unique per JVM; the test drops it when the class finishes. */
    static final String SCHEMA = "gcsp_s_handover_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(new RealPortsProfile().getConfigOverrides());
        for (String area : List.of("approvals", "documents", "ordering", "appointments")) m.put("gcsp." + area + ".provider", "synthetic");
        m.put("gcsp.account.provider", "repository");
        m.put("gcsp.scenario.provider", "demo");
        m.put("gcsp.reset-allowed", "true");
        m.put("gcsp.claims.sweep-interval", "10m");
        m.put("gcsp.notify.drain-interval", "10m");
        if ("true".equals(m.get("quarkus.datasource.active"))) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            m.put("quarkus.flyway.schemas", SCHEMA);
            m.put("quarkus.flyway.default-schema", SCHEMA);
        }
        return m;
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
