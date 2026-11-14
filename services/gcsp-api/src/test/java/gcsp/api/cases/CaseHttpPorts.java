package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/** Test port adapters, enabled only by the case HTTP profiles: the retained Node seed policy and one known renewal. */
public final class CaseHttpPorts {

    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    private CaseHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class SeedPolicy implements CasePolicyPort {
        @Override
        public Optional<Map<String, JsonNode>> assumptions(String policyVersion) {
            try {
                JsonNode seed = CaseJson.M.readTree(Files.readString(SEED));
                Map<String, JsonNode> rows = new LinkedHashMap<>();
                for (JsonNode a : seed.get("assumptions")) {
                    String key = a.get("key").asText();
                    if (CasePolicy.KEYS.contains(key) && policyVersion.equals(a.get("policyVersion").asText())) {
                        rows.put(key, a.deepCopy());
                    }
                }
                return rows.isEmpty() ? Optional.empty() : Optional.of(rows);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    @Alternative
    @ApplicationScoped
    public static class KnownRenewal implements CaseAccountPort {
        @Override
        public Lookup renewal(String environmentId, String runId, String employeeId) {
            return Lookup.ok("Paula Example", "renewal:" + employeeId, "2026-12-01");
        }
    }
}
