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

    RunLookup currentRun(String environmentId);

    StockRead read(EvidenceContext context, String orderUuid);
}
