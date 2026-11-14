package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.documents.DocumentStore.ItemRow;
import gcsp.api.documents.DocumentStore.OperationRow;
import gcsp.api.documents.DocumentStore.OrderRow;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Employee acknowledgement: intent in one transaction, the provider call outside any transaction, then a
 * finalizing transaction. Only a provider answer with matching evidence ever completes an item.
 */
final class DocumentAcknowledgement {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Set<String> FIELDS = Set.of("commandId", "orderUuid", "itemId", "expectedDocumentsRevision");
    static final String UNSUPPORTED_REASON = "This step cannot be acknowledged here yet.";
    static final String REFUSED_REASON = "The provider refused this acknowledgement.";
    private static final String PENDING_REASON = "The provider has not confirmed this acknowledgement yet. "
            + "Send the same request again to check.";

    private final TransactionRunner runner;
    private final DocumentStore store;
    private final DocumentClock clock;
    private final DocumentProviderPort provider;

    DocumentAcknowledgement(TransactionRunner runner, DocumentStore store, DocumentClock clock,
            DocumentProviderPort provider) {
        this.runner = runner;
        this.store = store;
        this.clock = clock;
        this.provider = provider;
    }

    DocumentOutcome acknowledge(RunContext ctx, String employeeId, JsonNode body) {
        DocumentOutcome invalid = validate(body);
        if (invalid != null) return invalid;
        if (!provider.supportsAcknowledgement()) {
            return DocumentOutcome.unsupported("acknowledgement-unsupported", UNSUPPORTED_REASON);
        }
        Optional<Instant> now = clock.now(ctx);
        if (now.isEmpty()) {
            return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
        }
        String commandId = body.get("commandId").asText();
        String orderUuid = body.get("orderUuid").asText();
        String itemId = body.get("itemId").asText();
        long expected = body.get("expectedDocumentsRevision").asLong();
        ArrayNode parts = F.arrayNode().add(ctx.runId()).add(orderUuid).add(itemId).add(commandId);
        String operationId = Canonical.digest(parts).substring(0, 32);
        Outcome intent;
        try {
            intent = runner.execute(ctx, new Command("documents.acknowledge", "documents:ack:" + commandId, body),
                    (tx) -> intentWork(tx, employeeId, operationId, body, orderUuid, itemId, commandId, expected));
        } catch (RuntimeException e) {
            return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
        }
        if (intent instanceof Outcome.Refused r) return refusal(ctx, r, orderUuid, itemId);
        if (intent instanceof Outcome.Uncertain) return DocumentOutcome.uncertain(operationId);
        if (!(intent instanceof Outcome.Committed c)) return DocumentOutcome.from(intent);
        String recorded = c.result().path("operationId").asText(operationId);
        return settle(ctx, now.get(), recorded, orderUuid, itemId);
    }

    private static DocumentOutcome validate(JsonNode body) {
        if (body == null || !body.isObject()) {
            return DocumentOutcome.invalid("body", "Supply the acknowledgement as an object.");
        }
        for (String name : (Iterable<String>) body::fieldNames) {
            if (!FIELDS.contains(name)) return DocumentOutcome.invalid(name, "This field is not accepted.");
        }
        if (!text(body.get("commandId"), 128)) {
            return DocumentOutcome.invalid("commandId", "Supply commandId as text of 1 to 128 characters.");
        }
        if (!text(body.get("orderUuid"), 128)) {
            return DocumentOutcome.invalid("orderUuid", "Supply orderUuid as text of 1 to 128 characters.");
        }
        if (!text(body.get("itemId"), 64)) {
            return DocumentOutcome.invalid("itemId", "Supply itemId as text of 1 to 64 characters.");
        }
        JsonNode revision = body.get("expectedDocumentsRevision");
        if (revision == null || !revision.isIntegralNumber() || !revision.canConvertToLong()
                || revision.asLong() <= 0) {
            return DocumentOutcome.invalid("expectedDocumentsRevision",
                    "Supply the documents revision you last saw as a whole number above zero.");
        }
        return null;
    }

    private static boolean text(JsonNode node, int max) {
        return node != null && node.isTextual() && !node.asText().isEmpty() && node.asText().length() <= max;
    }

    private WorkResult intentWork(Tx tx, String employeeId, String operationId, JsonNode body, String orderUuid,
            String itemId, String commandId, long expected) throws SQLException {
        Optional<OrderRow> locked = DocumentStore.orderForUpdate(tx, orderUuid);
        if (locked.isEmpty()) {
            return WorkResult.refuse("document-order-not-found", "No document items are open for this order.");
        }
        OrderRow order = locked.get();
        if (!order.employeeId().equals(employeeId)) {
            return WorkResult.refuse("not-resource-owner", "These documents belong to another employee.");
        }
        Optional<ItemRow> found = DocumentStore.items(tx, orderUuid).stream()
                .filter((i) -> i.itemId().equals(itemId)).findFirst();
        if (found.isEmpty() || !"employee".equals(found.get().owner())) {
            return WorkResult.refuse("not-your-task", "This item is not yours to complete.");
        }
        if (order.version() != expected) {
            return WorkResult.refuse("stale-version", "These documents changed. Refresh and try again.");
        }
        if (!"waiting-for-employee".equals(found.get().status())) {
            return WorkResult.refuse("task-not-waiting", "This step is not waiting for you.");
        }
        PendingOperations.recordIntent(tx, operationId, "documents.acknowledge",
                orderUuid + ":" + itemId + ":" + commandId, body);
        setItem(tx, orderUuid, itemId, "acknowledging", null, null, null, null);
        bumpOrder(tx, orderUuid, order.version());
        return WorkResult.ok(F.objectNode().put("operationId", operationId).put("orderUuid", orderUuid)
                .put("itemId", itemId));
    }

    /** One place that maps a refusal code to its answer; stale and not-waiting carry the current state. */
    private DocumentOutcome refusal(RunContext ctx, Outcome.Refused r, String orderUuid, String itemId) {
        switch (r.code()) {
            case "document-order-not-found":
                return DocumentOutcome.notFound(r.code(), r.message());
            case "not-resource-owner":
            case "not-your-task":
                return DocumentOutcome.forbidden(r.code(), r.message());
            case "stale-version":
            case "task-not-waiting":
                return conflictWithCurrent(ctx, r, orderUuid, itemId);
            default:
                return DocumentOutcome.from(r);
        }
    }

    private DocumentOutcome conflictWithCurrent(RunContext ctx, Outcome.Refused r, String orderUuid, String itemId) {
        ObjectNode current = F.objectNode();
        try {
            Optional<OrderRow> order = store.order(ctx, orderUuid);
            if (order.isPresent()) current.put("documentsRevision", order.get().version());
            if ("task-not-waiting".equals(r.code())) {
                store.items(ctx, List.of(orderUuid)).getOrDefault(orderUuid, List.of()).stream()
                        .filter((i) -> i.itemId().equals(itemId)).findFirst()
                        .ifPresent((i) -> current.put("status", i.status()));
            }
        } catch (DocumentStore.StoreUnavailable e) {
            // the refusal stands without the current state
        }
        return DocumentOutcome.conflict(r.code(), r.message(), "stale-version".equals(r.code()), current);
    }

    /** Reads the durable operation: a final one answers from the record, an open one asks the provider again. */
    private DocumentOutcome settle(RunContext ctx, Instant now, String operationId, String orderUuid,
            String itemId) {
        Optional<OperationRow> found;
        try {
            found = store.operation(ctx, operationId);
        } catch (DocumentStore.StoreUnavailable e) {
            return DocumentOutcome.pending("acknowledgement-pending", PENDING_REASON, operationId);
        }
        if (found.isEmpty()) {
            return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
        }
        OperationRow op = found.get();
        switch (op.state()) {
            case "acknowledged":
                return answer(ctx, now, F.objectNode().put("state", "acknowledged").put("operationId", operationId)
                        .put("orderUuid", orderUuid));
            case "refused":
                return answer(ctx, now, F.objectNode().put("state", op.outcome().path("kind").asText("refused"))
                        .put("operationId", operationId).put("orderUuid", orderUuid)
                        .put("reason", op.outcome().path("reason").asText(REFUSED_REASON)));
            default:
                return callAndFinalize(ctx, now, op, orderUuid, itemId);
        }
    }

    private DocumentOutcome callAndFinalize(RunContext ctx, Instant now, OperationRow op, String orderUuid,
            String itemId) {
        DocumentProviderPort.Result r;
        try {
            r = provider.acknowledge(new DocumentProviderPort.Acknowledgement(op.operationId(), ctx.runId(),
                    orderUuid, itemId, ctx.actorId(), now));
        } catch (RuntimeException e) {
            r = null;
        }
        ObjectNode result = classify(r, op.operationId());
        ObjectNode input = F.objectNode();
        input.put("operationId", op.operationId());
        input.set("result", result);
        Command command = new Command("documents.acknowledge.finalize",
                "documents:ack-final:" + op.operationId() + ":" + op.version(), input);
        Outcome outcome;
        try {
            outcome = runner.execute(ctx, command,
                    (tx) -> finalizeWork(tx, op, orderUuid, itemId, now, result));
        } catch (RuntimeException e) {
            return DocumentOutcome.pending("acknowledgement-pending", PENDING_REASON, op.operationId());
        }
        if (outcome instanceof Outcome.Committed c) return answer(ctx, now, c.result());
        if (outcome instanceof Outcome.Uncertain) return DocumentOutcome.uncertain(op.operationId());
        // The provider answer could not be recorded; the operation stays open for the same reconcile.
        if (outcome instanceof Outcome.Unavailable) {
            return DocumentOutcome.pending("acknowledgement-pending", PENDING_REASON, op.operationId());
        }
        return DocumentOutcome.from(outcome);
    }

    /** acknowledged only with object evidence naming this operation; anything unclear stays pending. */
    private static ObjectNode classify(DocumentProviderPort.Result r, String operationId) {
        ObjectNode node = F.objectNode();
        String status = r == null || r.status() == null ? "unavailable" : r.status();
        boolean matches = r != null && (r.operationId() == null || operationId.equals(r.operationId()));
        String kind = "pending";
        if (r != null && matches) {
            switch (status) {
                case "acknowledged":
                    JsonNode evidence = r.evidence();
                    if (evidence != null && evidence.isObject()
                            && operationId.equals(r.operationId())
                            && evidence.path("operationId").isTextual()
                            && operationId.equals(evidence.path("operationId").asText())) {
                        kind = "acknowledged";
                        node.set("evidence", evidence);
                    }
                    break;
                case "refused":
                    kind = "refused";
                    break;
                case "unsupported":
                    kind = "unsupported";
                    break;
                default:
                    break;
            }
        }
        node.put("kind", kind);
        node.put("providerStatus", status);
        node.put("providerReference", r == null ? null : r.providerReference());
        node.put("reason", r == null || r.reason() == null || r.reason().isBlank() ? null : r.reason());
        return node;
    }

    private WorkResult finalizeWork(Tx tx, OperationRow op, String orderUuid, String itemId, Instant now,
            ObjectNode result) throws SQLException {
        Optional<OrderRow> locked = DocumentStore.orderForUpdate(tx, orderUuid);
        if (locked.isEmpty()) {
            return WorkResult.refuse("document-order-not-found", "No document items are open for this order.");
        }
        OrderRow order = locked.get();
        long version = PendingOperations.version(tx, op.operationId());
        if (version != op.version()) throw new TxConflict("stale-version", "The operation changed since it was read");
        Optional<ItemRow> item = DocumentStore.items(tx, orderUuid).stream()
                .filter((i) -> i.itemId().equals(itemId)).findFirst();
        if (item.isEmpty() || !"acknowledging".equals(item.get().status())) {
            throw new TxConflict("stale-version", "The step is no longer waiting for this acknowledgement");
        }
        String kind = result.path("kind").asText();
        String reference = result.path("providerReference").asText(null);
        String reason = result.path("reason").asText(null);
        ObjectNode answer = F.objectNode().put("operationId", op.operationId()).put("orderUuid", orderUuid)
                .put("itemId", itemId).put("state", kind);
        switch (kind) {
            case "acknowledged": {
                JsonNode evidence = result.get("evidence");
                PendingOperations.finalize(tx, op.operationId(), version, "acknowledged", reference, evidence);
                setItem(tx, orderUuid, itemId, "complete", reference, null, now, evidence);
                bumpOrder(tx, orderUuid, order.version());
                break;
            }
            case "refused":
            case "unsupported": {
                String shown = "refused".equals(kind) && reason != null ? reason
                        : "refused".equals(kind) ? REFUSED_REASON : UNSUPPORTED_REASON;
                ObjectNode outcome = F.objectNode().put("kind", kind).put("reason", shown);
                PendingOperations.finalize(tx, op.operationId(), version, "refused", null, outcome);
                setItem(tx, orderUuid, itemId, "waiting-for-employee", null, shown, null, null);
                bumpOrder(tx, orderUuid, order.version());
                answer.put("reason", shown);
                break;
            }
            default: {
                ObjectNode outcome = F.objectNode().put("kind", "pending")
                        .put("providerStatus", result.path("providerStatus").asText());
                PendingOperations.markPending(tx, op.operationId(), version, outcome);
                break;
            }
        }
        return WorkResult.ok(answer);
    }

    /** The answer for a recorded state: acknowledged shows the order, refusals and pending say so. */
    private DocumentOutcome answer(RunContext ctx, Instant now, JsonNode result) {
        String operationId = result.path("operationId").asText(null);
        switch (result.path("state").asText()) {
            case "acknowledged": {
                String orderUuid = result.path("orderUuid").asText();
                try {
                    Optional<OrderRow> order = store.order(ctx, orderUuid);
                    if (order.isPresent()) {
                        List<ItemRow> items = store.items(ctx, List.of(orderUuid)).getOrDefault(orderUuid, List.of());
                        return DocumentOutcome.ok(F.objectNode().set("order", DocumentView.present(order.get(),
                                items, now, provider.supportsAcknowledgement())));
                    }
                } catch (DocumentStore.StoreUnavailable e) {
                    // fall through: the same request replays to this answer once the store is back
                }
                return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
            }
            case "refused":
                return DocumentOutcome.conflict("acknowledgement-refused",
                        result.path("reason").asText(REFUSED_REASON), false);
            case "unsupported":
                return DocumentOutcome.unsupported("acknowledgement-unsupported", UNSUPPORTED_REASON);
            default:
                return DocumentOutcome.pending("acknowledgement-pending", PENDING_REASON, operationId);
        }
    }

    private static void setItem(Tx tx, String orderUuid, String itemId, String status, String providerReference,
            String reason, Instant completedAt, JsonNode acknowledgement) throws SQLException {
        RunContext ctx = tx.context();
        tx.write("UPDATE document_items SET status = ?, provider_reference = ?, reason = ?, completed_at = ?, "
                + "acknowledgement = ? WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND item_id = ?",
                status, providerReference, reason, completedAt, acknowledgement, ctx.environmentId(), ctx.runId(),
                orderUuid, itemId);
    }

    private static void bumpOrder(Tx tx, String orderUuid, long version) throws SQLException {
        RunContext ctx = tx.context();
        tx.cas("UPDATE document_orders SET version = version + 1, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ? AND version = ?", ctx.environmentId(), ctx.runId(), orderUuid,
                version);
    }
}
