package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The selection as the employee sees it: status, summary, progress and the next action (Node projection). */
final class OrderingProjection {

    private static final ObjectMapper JSON = new ObjectMapper();

    private OrderingProjection() {}

    /** One selection joined to its pending operation. */
    record Row(String operationId, String employeeId, String slotId, String sourceType, String holdId, String orderUuid,
            String orderReference, String policyVersion, JsonNode selection, java.time.Instant leaseUntil, String state,
            long version, int attempts, String providerReference, JsonNode outcome, String inputDigest) {

        boolean open() {
            return "intent".equals(state) || "pending".equals(state);
        }

        String status() {
            return open() ? "pending" : state;
        }
    }

    static ObjectNode of(Row r) {
        ObjectNode v = JSON.createObjectNode();
        boolean acknowledged = "acknowledged".equals(r.state());
        boolean refused = "refused".equals(r.state());
        v.put("schemaVersion", 1);
        v.put("operationId", r.operationId());
        v.put("status", r.status());
        v.put("orderReference", r.orderReference());
        if (acknowledged) v.put("providerReference", r.providerReference());
        ObjectNode sel = v.putObject("selection");
        JsonNode s = r.selection();
        sel.put("sourceType", r.sourceType());
        sel.put("holdId", r.holdId());
        sel.put("orderUuid", r.orderUuid());
        sel.put("orderNumber", s.path("stock").path("orderNumber").asText(null));
        sel.put("configurationId", s.path("stock").path("configurationId").asText(null));
        sel.put("quoteId", s.path("quote").path("quoteId").asText(null));
        sel.put("termsVersion", s.path("terms").path("termsVersion").asText(null));
        sel.put("policyVersion", r.policyVersion());
        sel.put("receivedAt", s.path("receivedAt").asText(null));
        String selectionState = acknowledged ? "acknowledged" : refused ? "handoff-failed" : "handoff-pending";
        JsonNode names = s.path("terms").path("approvalStages");
        ObjectNode progress = v.putObject("progress");
        progress.put("selectionState", selectionState);
        progress.put("approved", false);
        progress.put("current", acknowledged && names.size() > 0 ? names.get(0).asText() : "selection received");
        ArrayNode stages = progress.putArray("stages");
        stages.addObject().put("name", "selection received").put("state",
                acknowledged ? "complete" : refused ? "failed" : "pending");
        for (int i = 0; i < names.size(); i++) {
            stages.addObject().put("name", names.get(i).asText()).put("state",
                    i == 0 && acknowledged ? "waiting" : "not-started");
        }
        ObjectNode view = v.putObject("view");
        view.put("state", acknowledged ? "awaiting-approval" : refused ? "handoff-failed" : "handoff-pending");
        view.put("action", acknowledged ? "view-order" : refused ? "contact-support" : "check-status");
        if (refused) v.putObject("failure").put("reason", r.outcome() == null ? null : r.outcome().path("reason").asText(null));
        v.put("attempts", (r.attempts() + 1) / 2);
        return v;
    }
}
