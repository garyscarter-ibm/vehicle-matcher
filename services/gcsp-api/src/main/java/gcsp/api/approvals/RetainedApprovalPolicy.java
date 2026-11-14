package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Reads the retained Node policy file (top-level policyVersion, assumptions[] with key and policyVersion). */
public final class RetainedApprovalPolicy implements ApprovalPolicyPort {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final Path file;

    public RetainedApprovalPolicy(Path file) {
        this.file = file;
    }

    @Override
    public Read entries(String policyVersion, List<String> keys) {
        JsonNode root;
        try {
            root = JSON.readTree(Files.readString(file));
        } catch (IOException | RuntimeException e) {
            return new Unavailable("policy-source-unavailable");
        }
        if (root == null || !root.path("policyVersion").isTextual() || !root.path("assumptions").isArray()) {
            return new Unavailable("policy-source-invalid");
        }
        if (!root.get("policyVersion").asText().equals(policyVersion)) return new VersionNotFound();
        Map<String, JsonNode> found = new LinkedHashMap<>();
        for (JsonNode row : root.get("assumptions")) {
            String key = row.path("key").asText(null);
            if (key == null || !keys.contains(key) || !policyVersion.equals(row.path("policyVersion").asText(null))) {
                continue;
            }
            if (found.put(key, row) != null) return new Unavailable("policy-source-invalid");
        }
        return new Found(policyVersion, found);
    }
}
