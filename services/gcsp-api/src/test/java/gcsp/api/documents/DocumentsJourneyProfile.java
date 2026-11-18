package gcsp.api.documents;

import gcsp.api.appointments.HandoverJourneyProfile;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The deployed documents composition: real RS256 identity, synthetic provider on canonical policy, no test alternative. */
public class DocumentsJourneyProfile implements QuarkusTestProfile {

    /** Unique per JVM; the test drops it when the class finishes. */
    static final String SCHEMA = "gcsp_s_docjourney_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(new HandoverJourneyProfile().getConfigOverrides());
        m.merge("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records", (a, b) -> a + "," + b);
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
        return new HandoverJourneyProfile().testResources();
    }
}
