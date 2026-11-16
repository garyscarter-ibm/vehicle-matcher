package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.offers.RemoteOfferDecisions.Pend;
import gcsp.api.offers.RemoteOfferDecisions.Rows;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.SelectionConversionPort;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.sql.SQLException;
import java.time.Instant;

/**
 * FUCQ-467: the Buddy offer source for a remote accept whose selection the remote confirmed. The decision was authorised
 * at intent, so this converts the pending rows to their final state without revalidating, in ordering's transaction.
 */
final class RemoteSelectionConversion implements SelectionConversionPort {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final BuddyOfferConversion account;
    private final String decisionOperationId;
    private final JsonNode pl;

    RemoteSelectionConversion(OfferDecisions decisions, String decisionOperationId, JsonNode payload) {
        Long mileage = payload.path("expectedReturnMileage").isIntegralNumber() ? payload.get("expectedReturnMileage").longValue()
                : null;
        this.account = new BuddyOfferConversion(decisions, new OfferDecisions.Verdict(),
                new BuddyOfferConversion.Ask(null, payload.path("offerId").asText(), payload.path("commandId").asText(),
                        payload.path("inputDigest").asText(), payload.path("priorVersions").path("offer").asLong(), mileage));
        this.decisionOperationId = decisionOperationId;
        this.pl = payload;
    }

    @Override
    public String sourceType() {
        return "buddy-offer";
    }

    @Override
    public Preparation prepare(OrderingScope scope, SourceInput source) {
        return account.prepare(scope, source);
    }

    @Override
    public Conversion convert(Tx tx, OrderingScope scope, ConversionRequest q) throws SQLException {
        RunContext x = tx.context();
        Pend p = RemoteOfferDecisions.pend(tx.connection(), x, decisionOperationId, " FOR UPDATE");
        if (p == null || !p.open() || !"confirmed".equals(p.lastKnown())) return new Refusal("decision-not-confirmed");
        Rows rows = RemoteOfferDecisions.load(tx.connection(), x, decisionOperationId);
        if (rows == null || !rows.aligned() || !q.holdId().equals(pl.path("holdId").asText())) {
            return new Refusal("selection-authority-changed");
        }
        String env = x.environmentId();
        String run = x.runId();
        String offerId = pl.path("offerId").asText();
        String holdId = pl.path("holdId").asText();
        String orderUuid = pl.path("orderUuid").asText();
        String decidedText = pl.path("decidedAt").asText();
        Object[] car = tx.first("SELECT configuration_id, attributes::text FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ?", rs -> new Object[] {rs.getString(1), OfferDecisions.json(rs.getString(2))}, env, run,
                orderUuid).orElse(null);
        Object[] ctx = tx.first("SELECT q.quote::text, h.attributes::text FROM buddy_quotes q, custody_holds h WHERE q.environment_id = ? "
                + "AND q.run_id = ? AND q.quote_id = ? AND h.environment_id = q.environment_id AND h.run_id = q.run_id "
                + "AND h.hold_id = ?", rs -> new Object[] {OfferDecisions.json(rs.getString(1)), OfferDecisions.json(rs.getString(2))},
                env, run, pl.path("quoteId").asText(), holdId).orElse(null);
        String orderNumber = car == null ? "" : ((JsonNode) car[1]).path("orderNumber").asText("");
        if (car == null || ctx == null || !orderNumber.matches("\\d{7}")) return new Refusal("selection-authority-changed");

        long offerVersion = pl.path("expectedOfferVersion").asLong();
        long holdVersion = pl.path("expectedHoldVersion").asLong();
        ObjectNode patch = F.objectNode().put("allocatedAt", q.now().toString());
        tx.cas("UPDATE custody_holds SET state = 'allocated', attributes = attributes || ?, version = version + 1, "
                + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND hold_id = ? AND version = ? "
                + "AND state = 'selection-pending'", patch, env, run, holdId, holdVersion);
        tx.cas("UPDATE buddy_offers SET state = 'accepted', version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND offer_id = ? AND version = ? AND state = 'decision-pending'",
                env, run, offerId, offerVersion);
        tx.cas("UPDATE stock_cars SET state = 'allocated', version = version + 1, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ? AND version = ? AND state = 'released'", env, run, orderUuid,
                pl.path("expectedStockVersion").asLong());

        String decisionId = pl.path("decisionId").asText();
        ObjectNode value = F.objectNode();
        value.put("schemaVersion", 1).put("offerId", offerId).put("decisionId", decisionId)
                .put("commandId", pl.path("commandId").asText()).put("decision", "accept").put("state", "accepted")
                .put("offerVersion", offerVersion + 1).put("holdVersion", holdVersion + 1).put("decidedAt", decidedText);
        value.putArray("availableActions");
        value.put("operationId", q.operationId());
        ObjectNode versions = pl.path("priorVersions").deepCopy();
        versions.put("policy", pl.path("policyVersion").asText()).put("briefVersion", pl.path("briefVersion").asLong())
                .put("quoteId", pl.path("quoteId").asText());
        versions.set("allowance", pl.path("allowance"));
        versions.put("operationId", q.operationId()).put("decisionOperationId", decisionOperationId);
        tx.write("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, "
                + "employee_id, hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accept', NULL, NULL, ?, ?, ?)", env, run, offerId, decisionId,
                pl.path("commandId").asText(), pl.path("inputDigest").asText(), pl.path("employeeId").asText(), holdId,
                versions, value, Instant.parse(decidedText));

        ObjectNode event = F.objectNode();
        event.put("holdId", holdId).put("orderUuid", orderUuid).put("offerId", offerId)
                .put("employeeId", pl.path("employeeId").asText()).put("decisionId", decisionId)
                .put("operationId", q.operationId()).put("quoteId", pl.path("quoteId").asText())
                .put("briefVersion", pl.path("briefVersion").asLong()).put("policyVersion", pl.path("policyVersion").asText())
                .put("occurredAt", decidedText);
        tx.emit("offer-accepted:" + holdId, "offer-accepted", event);

        ObjectNode out = F.objectNode().put("state", "accepted").put("offerId", offerId).put("holdId", holdId)
                .put("decisionId", decisionId).put("selectionOperationId", q.operationId());
        tx.cas("UPDATE pending_operations SET state = 'acknowledged', outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? "
                + "AND state IN ('intent', 'pending')", out, env, run, decisionOperationId, p.version());

        ObjectNode quote = ((JsonNode) ctx[0]).deepCopy();
        quote.put("quoteId", pl.path("quoteId").asText());
        JsonNode renewal = ((JsonNode) ctx[1]).path("renewalId");
        JsonNode facts = ((JsonNode) ctx[0]).path("snapshot").path("facts");
        return new Converted(orderUuid, orderNumber, (String) car[0], quote, facts.isMissingNode() ? F.objectNode() : facts.deepCopy(),
                renewal.isTextual() ? renewal.textValue() : null);
    }
}
