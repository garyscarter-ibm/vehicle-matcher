package gcsp.api.appointments;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Files;
import java.nio.file.Path;
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
        if ("true".equals(m.get("quarkus.datasource.active"))) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            m.put("quarkus.flyway.schemas", SCHEMA);
            m.put("quarkus.flyway.default-schema", SCHEMA);
        }
        return m;
    }

    /** Return time is the last supply tick, so supply is configured as deployed, on ids that never meet the seeded cars. */
    static Map<String, String> supply() {
        try {
            Path plan = Path.of("target/return-journey-tranche-plan.json").toAbsolutePath();
            Files.createDirectories(plan.getParent());
            Files.writeString(plan, Files.readString(Path.of("src/test/resources/supply/tranche-plan.json"))
                    .replace("-00000000000", "-0000000000f"));
            return Map.of("gcsp.supply.provider", "tranche-plan", "gcsp.supply.tranche-plan-file", plan.toString(),
                    "gcsp.supply.policy-file", Path.of("src/test/resources/supply/policy.json").toAbsolutePath().toString());
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
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
