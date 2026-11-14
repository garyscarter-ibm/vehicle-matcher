package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;

/** Same-run stock reads for the stock route; the persistence slice implements it, tests use doubles. */
public interface StockPort {

    /** status "ok" carries the current runId; any other status means the run could not be read. */
    record RunLookup(String status, String runId) {}

    /** status "ok" carries the row; "not-found" and other statuses map as in Node. */
    record StockRead(String status, StockRecord record) {}

    /** The stock row fields the lookup checks; facts is a legacy envelope or a vehicle-snapshot-v1 object. */
    record StockRecord(String runId, String orderUuid, String orderNumber, String configurationId, JsonNode facts) {}

    /** Inventory verdict for an order UUID: "ok" (configurationId set), "not-found", "identity-mismatch" or "source-unavailable". */
    record StockClassification(String status, String configurationId, String vehicleId) {

        public static StockClassification ok(String configurationId, String vehicleId) {
            return new StockClassification("ok", configurationId, vehicleId);
        }

        public static StockClassification notFound() {
            return new StockClassification("not-found", null, null);
        }

        public static StockClassification mismatch() {
            return new StockClassification("identity-mismatch", null, null);
        }

        public static StockClassification unavailable() {
            return new StockClassification("source-unavailable", null, null);
        }
    }

    RunLookup currentRun(String environmentId);

    StockRead read(EvidenceContext context, String orderUuid);

    /** Classifies an order UUID against the run's retained allocation inventory; the persistence slice implements it. */
    StockClassification classify(EvidenceContext context, String orderUuid);
}
