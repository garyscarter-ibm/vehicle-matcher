package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

/**
 * The retained Node-shaped offer, hold, decision, quote and receipt rows of one run. The production adapter reads
 * actual persisted Java producers within the record service's snapshot; unavailable sources never invent observations.
 */
public interface LearningOutcomeRows {

    record Rows(List<JsonNode> offers, List<JsonNode> holds, List<JsonNode> decisions, List<JsonNode> quotes,
            List<JsonNode> receipts) {
        public static final Rows EMPTY = new Rows(List.of(), List.of(), List.of(), List.of(), List.of());
    }

    /** False only for an explicitly unbound source: the read reports the outcome sources as unknown. */
    boolean bound();

    /** Reads inside the service's one snapshot connection, so a bound producer joins the same consistent read. */
    Rows read(Connection snapshot, String environmentId, String runId) throws SQLException;
}
