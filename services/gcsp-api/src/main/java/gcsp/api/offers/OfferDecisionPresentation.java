package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Tx;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;

/** Browser decision receipts over the immutable decision and its actual, scoped ordering operation. */
final class OfferDecisionPresentation {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    static final String SNAPSHOT = "browserReceiptFacts";

    private OfferDecisionPresentation() {}

    /** Capture in the decision/intent transaction. A browser command cannot commit without its exact run-clock fact. */
    static ObjectNode capture(Tx tx, OfferDecisions.Locked rows, Instant now, boolean required) throws SQLException {
        String clockVersion = tx.first("SELECT clock_version::text FROM run_clocks WHERE environment_id = ? "
                + "AND run_id = ? AND clock_instant = ?", rs -> rs.getString(1), tx.context().environmentId(),
                tx.context().runId(), now).orElse(null);
        if (clockVersion == null) {
            if (required) throw new SQLException("Decision run clock is unavailable or changed");
            return null;
        }
        var offer = rows.offer();
        return F.objectNode().put("runId", tx.context().runId()).put("quoteId", offer.quoteId())
                .put("policyVersion", offer.policyVersion()).put("expiresAt", PolicyClock.iso(rows.hold().expiresAt()))
                .put("serverNow", PolicyClock.iso(now)).put("clockVersion", clockVersion)
                .put("employeeId", offer.employeeId()).put("slotId", rows.hold().slotId())
                .put("holdId", rows.holdId()).put("orderUuid", offer.orderUuid())
                .put("configurationId", rows.car().configurationId()).put("briefVersion", offer.briefVersion());
    }

    static void retain(ObjectNode target, JsonNode facts) {
        if (facts != null && facts.isObject()) target.set(SNAPSHOT, facts.deepCopy());
    }

    static ObjectNode of(Connection c, Principal p, String offerId, JsonNode decision) throws SQLException {
        JsonNode facts = decision.path(SNAPSHOT);
        String state = decision.path("state").asText();
        if (!facts.isObject() || !p.runId().equals(facts.path("runId").asText())
                || !p.employeeId().equals(facts.path("employeeId").asText())
                || !offerId.equals(decision.path("offerId").asText())
                || !("accepted".equals(state) || "declined".equals(state))) return null;
        ObjectNode out = select(facts, "runId", "quoteId", "policyVersion", "expiresAt", "serverNow", "clockVersion");
        out.put("schemaVersion", 1).put("offerId", offerId).put("quoteVersion", 1);
        for (String key : new String[] {"commandId", "decisionId", "offerVersion", "holdVersion"}) out.set(key, decision.path(key));
        out.set("requestedDecision", decision.path("decision"));
        out.put("state", state).put("reason", state).put("offerState", state)
                .put("holdState", "accepted".equals(state) ? "allocated" : "released")
                .put("reconciliationRequired", false);
        out.putArray("availableActions");
        out.set("operationId", decision.hasNonNull("operationId") ? decision.get("operationId") : F.nullNode());
        if ("accepted".equals(state)) {
            JsonNode selection = selection(c, p, facts, decision.path("operationId").asText(null));
            if (selection == null) return null;
            out.set("selection", selection);
        }
        return out;
    }

    private record Order(JsonNode selection, String state, JsonNode outcome, String orderReference,
            String employeeId, String slotId, String orderUuid, String policyVersion) {}

    /** Read only the operation named by the saved decision; never submit, reconcile or infer provider success. */
    private static JsonNode selection(Connection c, Principal p, JsonNode facts, String operationId) throws SQLException {
        if (operationId == null) return null;
        Order row = OfferDecisions.one(c, "SELECT s.selection::text, o.state, o.outcome::text, s.order_reference, "
                + "s.employee_id, s.entitlement_slot_id, s.order_uuid, s.policy_version FROM selection_orders s "
                + "JOIN pending_operations o ON o.environment_id = s.environment_id AND o.run_id = s.run_id "
                + "AND o.operation_id = s.operation_id WHERE s.environment_id = ? AND s.run_id = ? "
                + "AND s.operation_id = ? AND s.employee_id = ?",
                rs -> new Order(OfferDecisions.json(rs.getString(1)), rs.getString(2), OfferDecisions.json(rs.getString(3)),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8)),
                p.environmentId(), p.runId(), operationId, p.employeeId());
        if (row == null || !row.slotId().equals(facts.path("slotId").asText())
                || !row.orderUuid().equals(facts.path("orderUuid").asText())) return null;
        JsonNode saved = row.selection();
        JsonNode source = saved.path("source");
        JsonNode quote = saved.path("quote");
        JsonNode stock = saved.path("stock");
        if (!"buddy-offer".equals(source.path("type").asText())
                || !facts.path("holdId").equals(source.path("holdId"))
                || !facts.path("quoteId").equals(quote.path("quoteId"))
                || !row.orderUuid().equals(stock.path("orderUuid").asText())
                || !facts.path("configurationId").equals(stock.path("configurationId"))) return null;
        boolean acknowledged = "acknowledged".equals(row.state());
        boolean refused = "refused".equals(row.state());
        if (!acknowledged && !refused && !"intent".equals(row.state()) && !"pending".equals(row.state())) return null;
        if (acknowledged && !"confirmed".equals(row.outcome().path("status").asText())) return null;
        if (!row.policyVersion().equals(saved.path("terms").path("policyVersion").asText())) return null;
        // The unchanged command handoff contract requires one policy for quote and ordering terms.
        // A retained quote can validly use older policy. Keep the accepted receipt and operation id,
        // omit that optional inline handoff, and let the current-offer read show saved ordering progress.
        if (!row.policyVersion().equals(facts.path("policyVersion").asText())) return F.nullNode();

        ObjectNode out = F.objectNode().put("schemaVersion", 1).put("operationId", operationId)
                .put("operationState", acknowledged ? "acknowledged" : refused ? "handoff-failed" : "handoff-pending")
                .put("selectionReceived", true).put("orderReference", row.orderReference());
        ObjectNode selected = select(saved, "schemaVersion", "orderReference", "receivedAt", "source");
        ObjectNode publicQuote = select(facts, "runId", "quoteId", "orderUuid", "employeeId", "configurationId", "briefVersion", "policyVersion");
        publicQuote.put("version", 1).put("entitlementSlotId", row.slotId());
        selected.set("quote", publicQuote);
        selected.set("stock", select(stock, "orderUuid", "orderNumber", "configurationId"));
        selected.set("terms", select(saved.path("terms"), "termsVersion", "policyVersion", "approvalStages"));
        selected.putObject("employeeAuthority").put("employeeId", row.employeeId());
        selected.putObject("vehicleSlot").put("employeeId", row.employeeId()).put("runId", p.runId())
                .put("entitlementSlotId", row.slotId());
        out.set("selection", selected);
        String selectionState = acknowledged ? "acknowledged" : refused ? "handoff-failed" : "handoff-pending";
        JsonNode names = saved.path("terms").path("approvalStages");
        if (!names.isArray() || names.isEmpty()) return null;
        ObjectNode progress = out.putObject("progress").put("schemaVersion", 1).put("selectionState", selectionState)
                .put("approved", false).put("current", acknowledged ? names.get(0).asText() : "selection received");
        var stages = progress.putArray("stages");
        stages.addObject().put("name", "selection received").put("state", acknowledged ? "complete" : refused ? "failed" : "pending");
        for (int i = 0; i < names.size(); i++) stages.addObject().put("name", names.get(i).asText())
                .put("state", acknowledged && i == 0 ? "waiting" : "not-started");
        out.putObject("view").put("state", acknowledged ? "awaiting-approval" : refused ? "handoff-failed" : "handoff-pending")
                .put("action", acknowledged ? "view-order" : refused ? "contact-support" : "check-status");
        out.set("order", acknowledged ? select(row.outcome(), "status", "operationId", "runId", "orderUuid",
                "configurationId", "orderNumber", "orderStatus", "fictional") : F.nullNode());
        if (refused) {
            ObjectNode failure = select(row.outcome(), "status", "reason", "fictional");
            failure.put("operationId", operationId).put("runId", p.runId()).put("orderUuid", row.orderUuid());
            out.set("failure", failure);
        } else out.putNull("failure");
        return out;
    }

    private static ObjectNode select(JsonNode source, String... keys) {
        ObjectNode out = F.objectNode();
        for (String key : keys) if (source.has(key)) out.set(key, source.get(key).deepCopy());
        return out;
    }
}
