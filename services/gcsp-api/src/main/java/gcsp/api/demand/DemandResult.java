package gcsp.api.demand;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** What a demand read returns; the HTTP layer maps Ok to 200 and a Refusal to its http status and body. */
public sealed interface DemandResult {

    record Ok(ObjectNode value) implements DemandResult {}

    record Refusal(int http, String status, String code, String reason, boolean retryable) implements DemandResult {

        public ObjectNode body() {
            ObjectNode n = Demand.obj();
            n.put("status", status).put("code", code).put("reason", reason).put("retryable", retryable);
            return n;
        }

        static Refusal unavailable(String code) {
            return new Refusal(503, "unavailable", code, "The saved-demand projection is unavailable.", true);
        }

        static Refusal suitabilityUnavailable() {
            return new Refusal(503, "unavailable", "suitability-unavailable", "Car suitability could not be read. Try again.", true);
        }

        static Refusal staleRun() {
            return new Refusal(409, "stale-run", "stale-run", "The run is retired or does not exist. Refresh.", false);
        }
    }
}
