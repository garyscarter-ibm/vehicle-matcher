package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** GCSP_RETURNS_POLICY_FILE set to the seed with the return proposal and the return outcome switched on. */
public class ReturnOutcomeJourneyProfile implements QuarkusTestProfile {

    /** Unique per JVM; the test drops it when the class finishes. */
    static final String SCHEMA = "gcsp_s_retoutcome_" + Long.toHexString(System.nanoTime());
    static final Path POLICY = Path.of("target/return-outcome-policy.json").toAbsolutePath();
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(new HandoverJourneyProfile().getConfigOverrides());
        m.put("gcsp.returns.provider", "synthetic");
        m.putAll(ReturnJourneyProfile.supply());
        m.put("gcsp.returns.policy-file", writePolicy().toString());
        if ("true".equals(m.get("quarkus.datasource.active"))) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            m.put("quarkus.flyway.schemas", SCHEMA);
            m.put("quarkus.flyway.default-schema", SCHEMA);
        }
        return m;
    }

    /** The seed copied with only the two return switches changed. */
    static Path writePolicy() {
        try {
            ObjectMapper json = new ObjectMapper();
            JsonNode root = json.readTree(Files.readString(SEED));
            int changed = 0;
            for (JsonNode row : root.get("assumptions")) {
                String key = row.path("key").asText();
                if ("lifecycle.appointments.scenario.v1".equals(key)) {
                    ((ObjectNode) row.get("value")).put("proposeChange", true);
                    changed++;
                } else if ("lifecycle.return.outcome.v1".equals(key)) {
                    ((ObjectNode) row.get("value")).put("enabled", true);
                    changed++;
                }
            }
            if (changed != 2) throw new IllegalStateException("The seed rows to switch were not found");
            Files.createDirectories(POLICY.getParent());
            Files.writeString(POLICY, json.writeValueAsString(root));
            return POLICY;
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
