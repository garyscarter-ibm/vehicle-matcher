package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;

/** Transport-independent failure results; arbitrary input ids and underlying causes are never reflected. */
public final class EvidenceFailures {

    public static final String VERSION = "1.0.0";

    private record Entry(String code, String message, String action, boolean retryable) {}

    private static final Map<String, Entry> FAILURES = Map.of(
            "invalid-input", new Entry("invalid-vehicle-identifier",
                    "Use a canonical configuration ID, stock order UUID or 17-character VIN for the selected route.",
                    "correct-identifier", false),
            "not-found", new Entry("vehicle-not-found",
                    "This identifier is absent from the selected local data. Check the identifier and selected dataset.",
                    "check-identifier", false),
            "source-unavailable", new Entry("vehicle-source-unavailable",
                    "The local vehicle source is unavailable. Restore or configure its validated published inputs and retry.",
                    "retry-source", true),
            "unsupported", new Entry("vehicle-profile-unsupported",
                    "The selected source cannot satisfy this vehicle profile. Choose a supported dataset or contact scheme support.",
                    "review-profile", false),
            "identity-mismatch", new Entry("vehicle-identity-mismatch",
                    "The identity, configuration or current session does not match. Refresh the current context and review the source association.",
                    "refresh-review", false));

    private static final Map<String, Integer> HTTP = Map.of("complete", 200, "partial", 200, "invalid-input", 400,
            "not-found", 404, "source-unavailable", 503, "unsupported", 422, "identity-mismatch", 409);

    private EvidenceFailures() {}

    /** HTTP status for a result's status string; unknown or missing statuses are 503. */
    public static int httpStatus(String status) {
        return status == null ? 503 : HTTP.getOrDefault(status, 503);
    }

    public static int httpStatus(JsonNode outcome) {
        JsonNode status = outcome == null ? null : outcome.get("status");
        return httpStatus(status != null && status.isTextual() ? status.textValue() : null);
    }

    /** The result envelope shared by successes and failures. */
    static ObjectNode base(String status, String kind) {
        JsonNodeFactory f = JsonNodeFactory.instance;
        ObjectNode node = f.objectNode();
        node.put("contractVersion", VERSION);
        node.put("schemaVersion", "1");
        node.put("provider", "local-vehicle-evidence");
        node.put("providerVersion", "1");
        node.put("status", status);
        ObjectNode requested = node.putObject("requested");
        if (kind != null && List.of("configuration", "stock", "vin").contains(kind)) requested.put("kind", kind);
        else requested.putNull("kind");
        requested.putNull("id");
        node.putNull("resolved");
        node.putNull("identity");
        node.putNull("failure");
        node.putNull("completeness");
        ObjectNode routing = node.putObject("routing");
        routing.put("mode", "offline");
        routing.put("liveEligible", false);
        return node;
    }

    public static ObjectNode failure(String status, String kind) {
        Entry entry = FAILURES.get(status == null ? "" : status);
        String used = entry == null ? "source-unavailable" : status;
        if (entry == null) entry = FAILURES.get(used);
        ObjectNode node = base(used, kind);
        ObjectNode failure = node.putObject("failure");
        failure.put("code", entry.code());
        failure.put("message", entry.message());
        failure.put("action", entry.action());
        failure.put("retryable", entry.retryable());
        return node;
    }
}
