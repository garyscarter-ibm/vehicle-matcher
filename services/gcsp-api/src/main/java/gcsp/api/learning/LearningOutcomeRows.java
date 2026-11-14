package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

/**
 * The Node-shaped offer, hold, decision, quote and receipt rows of one run. No merged Java producer writes them yet
 * (offers and decisions FUCQ-466/467, quotes FUCQ-461, Buddy holds FUCQ-464), so the default binding is empty and unbound.
 */
public interface LearningOutcomeRows {

    record Rows(List<JsonNode> offers, List<JsonNode> holds, List<JsonNode> decisions, List<JsonNode> quotes,
            List<JsonNode> receipts) {
        public static final Rows EMPTY = new Rows(List.of(), List.of(), List.of(), List.of(), List.of());
    }

    /** False for the default binding: the read then reports the outcome sources as unknown. */
    boolean bound();

    /** Reads inside the service's one snapshot connection, so a bound producer joins the same consistent read. */
    Rows read(Connection snapshot, String environmentId, String runId) throws SQLException;
}
