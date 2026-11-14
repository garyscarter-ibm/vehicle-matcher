package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

/** Reads the retained Node policy file format (top-level policyVersion, effectiveFrom, assumptions[]). */
public final class RetainedPolicyFile implements ReleasePolicy {

    static final String SIZE = "supply.release.size";
    static final String LEAD = "supply.leadTimeDays";
    static final String MAX_AGE = "supply.stockSource.maxAgeMinutes";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Path file;

    public RetainedPolicyFile(Path file) {
        this.file = file;
    }

    @Override
    public PolicyReading read(String runId, Instant asOf) {
        JsonNode root;
        try {
            root = JSON.readTree(Files.readString(file));
        } catch (IOException | RuntimeException e) {
            return unavailable();
        }
        if (root == null || !root.path("policyVersion").isTextual() || root.path("policyVersion").asText().isEmpty()) {
            return unavailable();
        }
        String version = root.get("policyVersion").asText();
        Instant from = Iso.parse(root.path("effectiveFrom").asText(null));
        if (from == null || from.isAfter(asOf)) return unavailable();
        Integer size = integer(root, version, SIZE, asOf, null);
        Integer lead = integer(root, version, LEAD, asOf, null);
        Integer age = integer(root, version, MAX_AGE, asOf, "minutes");
        if (size == null || size <= 0 || lead == null || lead < 0 || age == null || age <= 0) return unavailable();
        return new PolicyReading.Ok(version, size, lead, age);
    }

    private static Integer integer(JsonNode root, String version, String key, Instant asOf, String unit) {
        JsonNode rows = root.path("assumptions");
        if (!rows.isArray()) return null;
        for (JsonNode row : rows) {
            if (!key.equals(row.path("key").asText(null))) continue;
            JsonNode value = row.path("value");
            if (!version.equals(row.path("policyVersion").asText(null)) || !value.isIntegralNumber()
                    || !value.canConvertToInt()) return null;
            if (unit != null && !unit.equals(row.path("unit").asText(null))) return null;
            if (row.has("effectiveFrom")) {
                Instant from = Iso.parse(row.get("effectiveFrom").asText(null));
                if (from == null || from.isAfter(asOf)) return null;
            }
            if (row.has("effectiveTo")) {
                Instant to = Iso.parse(row.get("effectiveTo").asText(null));
                if (to == null || !to.isAfter(asOf)) return null;
            }
            return value.asInt();
        }
        return null;
    }

    private static PolicyReading unavailable() {
        return new PolicyReading.Unavailable("The release policy is unavailable or incomplete.");
    }
}
