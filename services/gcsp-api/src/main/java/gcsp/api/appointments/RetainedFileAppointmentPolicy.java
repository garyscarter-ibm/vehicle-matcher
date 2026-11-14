package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

/** Reads the retained Node policy file format and validates like Node loadAppointmentPolicy and loadOutcomeTiming. */
public final class RetainedFileAppointmentPolicy implements AppointmentPolicy {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final Path file;
    private volatile JsonNode cached;

    public RetainedFileAppointmentPolicy(Path file) {
        this.file = file;
    }

    /** The run id is not used: a retained file is one run-independent document. */
    @Override
    public PolicyResult<AppointmentConfig> config(String runId, String policyVersion, Instant asOf) {
        JsonNode root = open(policyVersion, asOf);
        return root == null ? PolicyResult.unavailable()
                : AppointmentRules.config(policyVersion, key -> row(root, key, policyVersion, asOf));
    }

    @Override
    public PolicyResult<OutcomeTiming> timing(String runId, String policyVersion, Instant asOf) {
        JsonNode root = open(policyVersion, asOf);
        return root == null ? PolicyResult.unavailable()
                : AppointmentRules.timing(policyVersion, key -> row(root, key, policyVersion, asOf));
    }

    /** The parsed file when it is one version, already in force at asOf, and matches the pinned version. */
    private JsonNode open(String policyVersion, Instant asOf) {
        if (policyVersion == null || asOf == null) return null;
        JsonNode root = cached;
        if (root == null) {
            // A retained file is immutable once deployed, so it is parsed once, not per request or tick.
            try {
                root = JSON.readTree(Files.readString(file));
            } catch (IOException | RuntimeException e) {
                return null;
            }
            cached = root;
        }
        if (root == null || !root.path("policyVersion").isTextual() || !policyVersion.equals(root.get("policyVersion").asText())
                || !effective(root, asOf) || !root.path("assumptions").isArray()) return null;
        return root;
    }

    private static boolean effective(JsonNode node, Instant asOf) {
        Instant from = Iso.parse(node.path("effectiveFrom").asText(null));
        if (from == null || from.isAfter(asOf)) return false;
        if (!node.has("effectiveTo")) return true;
        Instant to = Iso.parse(node.get("effectiveTo").asText(null));
        return to != null && to.isAfter(from) && to.isAfter(asOf);
    }

    /** The one row for the key at the pinned version and instant; null when absent, repeated or not in force. */
    private static JsonNode row(JsonNode root, String key, String version, Instant asOf) {
        JsonNode found = null;
        for (JsonNode row : root.get("assumptions")) {
            if (!key.equals(row.path("key").asText(null))) continue;
            if (found != null) return null;
            found = row;
        }
        if (found == null || !version.equals(found.path("policyVersion").asText(null))) return null;
        boolean inForce = !found.has("effectiveFrom") && !found.has("effectiveTo") || effectiveRow(found, asOf);
        return inForce && found.has("value") && !found.get("value").isNull() ? found : null;
    }

    private static boolean effectiveRow(JsonNode row, Instant asOf) {
        if (row.has("effectiveFrom")) {
            Instant from = Iso.parse(row.get("effectiveFrom").asText(null));
            if (from == null || from.isAfter(asOf)) return false;
        }
        if (row.has("effectiveTo")) {
            Instant to = Iso.parse(row.get("effectiveTo").asText(null));
            return to != null && to.isAfter(asOf);
        }
        return true;
    }
}
