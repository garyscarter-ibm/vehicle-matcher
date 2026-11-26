package gcsp.api.appointments;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The deployed lifecycle block: synthetic returns on the canonical policy, every port real, no test alternative. */
public class ReturnJourneyProfile implements QuarkusTestProfile {

    /** Unique per JVM; the test drops it when the class finishes. */
    static final String SCHEMA = "gcsp_s_retjourney_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(new HandoverJourneyProfile().getConfigOverrides());
        m.put("gcsp.returns.provider", "synthetic");
        m.putAll(supply());
        m.merge("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records", (a, b) -> a + "," + b);
        if ("true".equals(m.get("quarkus.datasource.active"))) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            m.put("quarkus.flyway.schemas", SCHEMA);
            m.put("quarkus.flyway.default-schema", SCHEMA);
        }
        return m;
    }

    /** The real journey exercises return-clock independence from supply. */
    static Map<String, String> supply() {
        return Map.of("gcsp.supply.provider", "none");
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return new HandoverJourneyProfile().testResources();
    }
}
