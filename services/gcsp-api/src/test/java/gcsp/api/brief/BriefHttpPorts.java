package gcsp.api.brief;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import com.fasterxml.jackson.databind.JsonNode;

/** Test port adapters, enabled only by the brief HTTP profiles: the retained Node seed policy and one current car. */
public final class BriefHttpPorts {

    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    private BriefHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class SeedPolicy implements BriefPolicyPort {
        @Override
        public Optional<BriefAssumptions> assumptions(String policyVersion) {
            try {
                JsonNode seed = Json.M.readTree(Files.readString(SEED));
                Map<String, JsonNode> entries = new LinkedHashMap<>();
                for (JsonNode a : seed.get("assumptions")) {
                    String key = a.get("key").asText();
                    if (BriefAssumptions.KEYS.contains(key) && policyVersion.equals(a.get("policyVersion").asText())) {
                        entries.put(key, a.deepCopy());
                    }
                }
                return entries.isEmpty() ? Optional.empty() : Optional.of(new BriefAssumptions(policyVersion, entries));
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    @Alternative
    @ApplicationScoped
    public static class CurrentCar implements BriefAccountPort {
        @Override
        public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
            return Optional.of(new AccountFacts(new CurrentContract("contract-1", "Model X"), "facts-1"));
        }
    }
}
