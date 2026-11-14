package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Role;
import gcsp.api.documents.DocumentCasePort.CaseCheck;
import gcsp.api.documents.DocumentStore.ItemRow;
import gcsp.api.documents.DocumentStore.OrderRow;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/** Opens source-linked document orders, advances provider work between short transactions, projects readiness. */
public final class DocumentService {

    public static final String CONTRACT = "lifecycle.documents.v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final int MAX_COMMAND_ID = 200;
    private static final String NOT_OWNER_REASON = "These documents belong to another employee.";
    private static final int MAX_FAILED_SHOWN = 20;

    private final TransactionRunner runner;
    private final DocumentStore store;
    private final DocumentPolicyPort policy;
    private final DocumentCasePort cases;
    private final DocumentClock clock;
    private final DocumentProviderPort provider;
    private final DocumentAcknowledgement acknowledgements;

    public DocumentService(TransactionRunner runner, DataSource dataSource, DocumentPolicyPort policy,
            DocumentCasePort cases, DocumentClock clock, DocumentProviderPort provider) {
        this.runner = runner;
        this.store = new DocumentStore(dataSource);
        this.policy = policy;
        this.cases = cases;
        this.clock = clock;
        this.provider = provider;
        this.acknowledgements = new DocumentAcknowledgement(runner, store, clock, provider);
    }

    /** The employee's own acknowledgement of one waiting task; see DocumentAcknowledgement for the outcomes. */
    public DocumentOutcome acknowledge(RunContext ctx, String employeeId, JsonNode body) {
        return acknowledgements.acknowledge(ctx, employeeId, body);
    }

    public DocumentOutcome readItems(RunContext ctx, String employeeId) {
        Optional<Instant> now = clock.now(ctx);
        if (now.isEmpty()) return unavailable();
        try {
            ObjectNode node = F.objectNode();
            node.put("contractVersion", CONTRACT);
            node.put("now", now.get().toString());
            ArrayNode orders = node.putArray("orders");
            viewsFor(ctx, employeeId, now.get()).forEach(orders::add);
            return DocumentOutcome.ok(node);
        } catch (DocumentStore.StoreUnavailable e) {
            return unavailable();
        }
    }

    /** The single readiness authority; an employee sees only their own orders, an operator any order. */
    public DocumentOutcome readReadiness(RunContext ctx, Principal principal, String orderUuid,
            String policyVersion) {
        if (orderUuid == null || orderUuid.isEmpty() || orderUuid.length() > 128) {
            return DocumentOutcome.invalid("orderUuid", "Supply the order to check.");
        }
        if (clock.now(ctx).isEmpty()) return unavailable();
        boolean employee = principal.roles().contains(Role.EMPLOYEE.wire());
        String self = principal.employeeId();
        if (employee) {
            DocumentCasePort.Owner owner = ownerOf(ctx, orderUuid);
            if (owner instanceof DocumentCasePort.Owner.Unavailable) return unavailable();
            if (owner instanceof DocumentCasePort.Owner.Owned o && !o.employeeId().equals(self)) {
                return DocumentOutcome.forbidden("not-resource-owner", NOT_OWNER_REASON);
            }
        }
        try {
            Optional<ObjectNode> opened = readiness(ctx, orderUuid, employee ? self : null);
            if (opened.isPresent()) return DocumentOutcome.ok(opened.get());
        } catch (ForeignOrder e) {
            return DocumentOutcome.forbidden("not-resource-owner", NOT_OWNER_REASON);
        } catch (DocumentStore.StoreUnavailable e) {
            return unavailable();
        }
        return notOpened(ctx, orderUuid, policyVersion, employee ? self : null);
    }

    private DocumentCasePort.Owner ownerOf(RunContext ctx, String orderUuid) {
        try {
            DocumentCasePort.Owner owner = cases.ownerOf(ctx, orderUuid);
            if (owner != null) return owner;
        } catch (RuntimeException e) {
            // an unreadable owner authority is unavailable, never a pass
        }
        return new DocumentCasePort.Owner.Unavailable("owner-unreadable");
    }

    private static final class ForeignOrder extends RuntimeException {
        ForeignOrder() {
            super(null, null, false, false);
        }
    }

    private Optional<ObjectNode> readiness(RunContext ctx, String orderUuid, String onlyEmployee) {
        Optional<OrderRow> order = store.order(ctx, orderUuid);
        if (order.isEmpty()) return Optional.empty();
        if (onlyEmployee != null && !order.get().employeeId().equals(onlyEmployee)) throw new ForeignOrder();
        List<ItemRow> items = store.items(ctx, List.of(orderUuid)).getOrDefault(orderUuid, List.of());
        ObjectNode node = F.objectNode();
        node.put("orderUuid", orderUuid);
        node.put("documentsRevision", order.get().version());
        node.put("opened", true);
        node.setAll(DocumentView.readiness(items));
        return Optional.of(node);
    }

    private DocumentOutcome notOpened(RunContext ctx, String orderUuid, String policyVersion, String onlyEmployee) {
        DocumentPolicy.Load load = DocumentPolicy.load(policy, policyVersion);
        String reason = DocumentPolicy.Load.Unavailable.CODE;
        String producerStatus = null;
        String producerCode = null;
        if (load instanceof DocumentPolicy.Load.Loaded loaded) {
            DocumentCasePort.StageRead read;
            try {
                read = cases.readStage(ctx, orderUuid);
            } catch (RuntimeException e) {
                read = null;
            }
            StageObservation.Observed observed = StageObservation.observe(read, ctx.runId(), orderUuid,
                    loaded.config().openingStage(), loaded.config().openingState());
            if (observed instanceof StageObservation.Observed.Forbidden) {
                return DocumentOutcome.forbidden("order-not-visible", "This order is not visible to you.");
            }
            if (observed instanceof StageObservation.Observed.Open open) {
                if (onlyEmployee != null && open.employeeId() != null && !open.employeeId().equals(onlyEmployee)) {
                    return DocumentOutcome.forbidden("not-resource-owner", NOT_OWNER_REASON);
                }
                reason = "awaiting-document-tick";
            } else {
                StageObservation.Observed.NotOpen n = (StageObservation.Observed.NotOpen) observed;
                if (onlyEmployee != null && n.employeeId() != null && !n.employeeId().equals(onlyEmployee)) {
                    return DocumentOutcome.forbidden("not-resource-owner", NOT_OWNER_REASON);
                }
                reason = n.reason();
                producerStatus = n.producerStatus();
                producerCode = n.producerCode();
            }
        }
        ObjectNode node = F.objectNode();
        node.put("orderUuid", orderUuid);
        node.put("opened", false);
        node.put("ready", false);
        node.put("state", "not-open");
        node.put("reason", reason);
        node.put("documentsComplete", false);
        node.put("vehicleReady", false);
        if (producerStatus != null) {
            node.put("producerStatus", producerStatus);
            node.put("producerCode", producerCode);
        }
        return DocumentOutcome.ok(node);
    }

    private static DocumentOutcome unavailable() {
        return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
    }

    /** One clock tick: open every listed order that reached the opening stage, then advance open provider work. */
    public DocumentOutcome tick(RunContext ctx, String tickId, Instant now, String policyVersion) {
        if (tickId == null || tickId.isEmpty() || tickId.length() > 100) {
            return DocumentOutcome.invalid("tickId", "Supply the tick id as text of at most 100 characters.");
        }
        if (now == null) return DocumentOutcome.invalid("now", "Supply the tick time.");
        if (policyVersion == null) return DocumentOutcome.invalid("policyVersion", "Supply the policy version.");
        Optional<Instant> current = clock.now(ctx);
        if (current.isEmpty()) {
            return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
        }
        if (!current.get().equals(now)) {
            return DocumentOutcome.conflict("stale-version", "Clock changed during this tick. Refresh and retry.",
                    true);
        }
        Summary summary = new Summary();
        DocumentPolicy.Load load = DocumentPolicy.load(policy, policyVersion);
        DocumentCasePort.OrderList listed = list(ctx);
        if (!"ok".equals(listed.status()) || listed.orderUuids() == null) {
            summary.producer = F.objectNode().put("status", listed.status()).put("code", listed.code());
        } else {
            summary.producerFailed(listed);
            for (String orderUuid : listed.orderUuids()) {
                if (orderUuid == null || orderUuid.isEmpty() || orderUuid.length() > 128) continue;
                if (load instanceof DocumentPolicy.Load.Loaded loaded) {
                    open(ctx, tickId, now, policyVersion, loaded.config(), orderUuid, summary);
                } else {
                    summary.blocked(orderUuid, "open", "unavailable");
                }
            }
        }
        try {
            advance(ctx, tickId, now, summary);
        } catch (DocumentStore.StoreUnavailable e) {
            return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
        }
        return DocumentOutcome.ok(summary.json());
    }

    public Optional<ObjectNode> view(RunContext ctx, String orderUuid, Instant now) {
        Optional<OrderRow> order = store.order(ctx, orderUuid);
        if (order.isEmpty()) return Optional.empty();
        List<ItemRow> items = store.items(ctx, List.of(orderUuid)).getOrDefault(orderUuid, List.of());
        return Optional.of(DocumentView.present(order.get(), items, now, provider.supportsAcknowledgement()));
    }

    public List<ObjectNode> viewsFor(RunContext ctx, String employeeId, Instant now) {
        List<OrderRow> orders = store.ordersFor(ctx, employeeId);
        Map<String, List<ItemRow>> items = store.items(ctx, orders.stream().map(OrderRow::orderUuid).toList());
        boolean ack = provider.supportsAcknowledgement();
        return orders.stream().map((o) -> DocumentView.present(o, items.getOrDefault(o.orderUuid(), List.of()), now,
                ack)).toList();
    }

    /** The order row is read before its items, so a changing order can only show an older revision, never newer. */
    public Optional<ObjectNode> readiness(RunContext ctx, String orderUuid) {
        return readiness(ctx, orderUuid, null);
    }

    private DocumentCasePort.OrderList list(RunContext ctx) {
        try {
            DocumentCasePort.OrderList listed = cases.listOrders(ctx);
            if (listed != null) return listed;
        } catch (RuntimeException e) {
            // an unreadable producer is reported, never treated as an empty list
        }
        return new DocumentCasePort.OrderList("unavailable", null, List.of(), List.of(), 0);
    }

    private void open(RunContext ctx, String tickId, Instant now, String policyVersion, DocumentPolicy.Config config,
            String orderUuid, Summary summary) {
        DocumentCasePort.StageRead read;
        try {
            read = cases.readStage(ctx, orderUuid);
        } catch (RuntimeException e) {
            read = null;
        }
        StageObservation.Observed observed = StageObservation.observe(read, ctx.runId(), orderUuid,
                config.openingStage(), config.openingState());
        if (observed instanceof StageObservation.Observed.NotOpen n) {
            summary.notOpen(orderUuid, n.reason());
            return;
        }
        if (observed instanceof StageObservation.Observed.Forbidden f) {
            summary.notOpen(orderUuid, f.reason());
            return;
        }
        StageObservation.Observed.Open open = (StageObservation.Observed.Open) observed;
        long revision = open.observation().get("lifecycleRevision").asLong();
        ObjectNode input = F.objectNode();
        input.put("tickId", tickId);
        input.put("orderUuid", orderUuid);
        input.set("observation", open.observation());
        ObjectNode authority = input.putObject("order");
        authority.put("entitlementSlotId", open.order().entitlementSlotId());
        authority.put("renewalId", open.order().renewalId());
        authority.put("renewalAuthority", open.order().renewalAuthority());
        input.put("policyVersion", policyVersion);
        Command command = new Command("documents.open",
                commandId("documents:open:", tickId, orderUuid, Long.toString(revision)), input);
        Outcome outcome;
        try {
            outcome = runner.execute(ctx, command, (tx) -> openWork(tx, config, open, orderUuid, now, policyVersion,
                    revision));
        } catch (RuntimeException e) {
            summary.blocked(orderUuid, "open", "unavailable");
            return;
        }
        if (outcome instanceof Outcome.Committed c) {
            JsonNode result = c.result();
            if (result.path("opened").asBoolean()) {
                summary.opened++;
            } else if ("not-open".equals(result.path("status").asText())) {
                summary.notOpen(orderUuid, result.path("reason").asText(null));
            }
        } else {
            summary.blocked(orderUuid, "open", DocumentOutcome.from(outcome).status());
        }
    }

    private WorkResult openWork(Tx tx, DocumentPolicy.Config config, StageObservation.Observed.Open open,
            String orderUuid, Instant now, String policyVersion, long revision) throws SQLException {
        Optional<OrderRow> existing = DocumentStore.orderForUpdate(tx, orderUuid);
        if (existing.isPresent()) {
            // Replay or a later revision: item progress is never reset, only the observed revision moves.
            OrderRow row = existing.get();
            if (row.lastObservedRevision() != revision) {
                tx.cas("UPDATE document_orders SET last_observed_revision = ?, version = version + 1, "
                        + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND order_uuid = ? "
                        + "AND version = ?", revision, tx.context().environmentId(), tx.context().runId(),
                        orderUuid, row.version());
            }
            return WorkResult.ok(F.objectNode().put("orderUuid", orderUuid).put("opened", false)
                    .put("status", "already-open"));
        }
        CaseCheck check;
        try {
            check = cases.checkCase(tx.context(), open.employeeId(), open.order());
        } catch (RuntimeException e) {
            check = new CaseCheck.Unavailable("case-check-failed");
        }
        if (check instanceof CaseCheck.Unavailable u) return WorkResult.refuse("case-unavailable", u.reason());
        if (check instanceof CaseCheck.Refused r) return notOpen(orderUuid, r.reason());
        String schemeId = ((CaseCheck.Valid) check).schemeId();
        List<DocumentPolicy.ItemDef> defs = DocumentPolicy.applicable(config, schemeId);
        // An order with no items would be trivially ready, so it is never opened.
        if (defs.isEmpty()) return notOpen(orderUuid, "no-document-items-for-scheme");
        insertOrder(tx, config, open, orderUuid, now, policyVersion, revision);
        for (int position = 0; position < defs.size(); position++) {
            insertItem(tx, config, defs.get(position), position, orderUuid, now);
        }
        return WorkResult.ok(F.objectNode().put("orderUuid", orderUuid).put("opened", true).put("items", defs.size()));
    }

    private static WorkResult notOpen(String orderUuid, String reason) {
        return WorkResult.ok(F.objectNode().put("orderUuid", orderUuid).put("opened", false)
                .put("status", "not-open").put("reason", reason));
    }

    private void insertOrder(Tx tx, DocumentPolicy.Config config, StageObservation.Observed.Open open,
            String orderUuid, Instant now, String policyVersion, long revision) throws SQLException {
        ObjectNode types = F.objectNode().put("overdue", config.exceptionTypes().overdue())
                .put("failed", config.exceptionTypes().failed());
        ArrayNode assumptions = F.arrayNode();
        config.assumptions().forEach(assumptions::add);
        RunContext ctx = tx.context();
        tx.write("INSERT INTO document_orders (environment_id, run_id, order_uuid, employee_id, entitlement_slot_id, "
                + "renewal_id, renewal_authority, policy_version, opened_at, opening, last_observed_revision, "
                + "provider_mode, exception_types, assumptions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ctx.environmentId(), ctx.runId(), orderUuid, open.employeeId(), open.order().entitlementSlotId(),
                open.order().renewalId(), open.order().renewalAuthority(), policyVersion, now, open.observation(),
                revision, provider.mode(), types, assumptions);
    }

    private void insertItem(Tx tx, DocumentPolicy.Config config, DocumentPolicy.ItemDef def, int position,
            String orderUuid, Instant now) throws SQLException {
        RunContext ctx = tx.context();
        boolean employee = "employee".equals(def.owner());
        JsonNode first = config.assumptions().get(0);
        ObjectNode assumption = F.objectNode();
        assumption.put("key", first.path("key").asText());
        assumption.put("itemId", def.itemId());
        assumption.put("status", first.path("status").asText());
        assumption.put("basis", def.basis());
        assumption.put("synthetic", true);
        String operationId = null;
        Instant progressAt = null;
        if (!employee) {
            ArrayNode parts = F.arrayNode().add(ctx.runId()).add(orderUuid).add(def.itemId());
            operationId = Canonical.digest(parts).substring(0, 32);
            progressAt = now.plusSeconds(def.progressSeconds());
        }
        tx.write("INSERT INTO document_items (environment_id, run_id, order_uuid, item_id, position, kind, label, "
                + "owner, action, status, due_at, progress_at, operation_id, fail, failure_reason, assumption) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ctx.environmentId(), ctx.runId(), orderUuid, def.itemId(), position, def.kind(), def.label(),
                def.owner(), def.action(), employee ? "waiting-for-employee" : "not-started",
                now.plusSeconds(def.dueSeconds()), progressAt, operationId,
                !employee && config.failItemIds().contains(def.itemId()), employee ? null : config.failureReason(),
                assumption);
    }

    /** One batched read of open orders and items, then provider calls outside any transaction, then one apply each. */
    private void advance(RunContext ctx, String tickId, Instant now, Summary summary) {
        List<String> uuids = store.ordersWithOpenItems(ctx);
        Map<String, OrderRow> orders = new HashMap<>();
        for (OrderRow order : store.orders(ctx, uuids)) orders.put(order.orderUuid(), order);
        Map<String, List<ItemRow>> items = store.items(ctx, uuids);
        for (String orderUuid : uuids) {
            OrderRow order = orders.get(orderUuid);
            if (order == null) continue;
            advanceOrder(ctx, tickId, now, order, items.getOrDefault(orderUuid, List.of()), summary);
        }
    }

    private void advanceOrder(RunContext ctx, String tickId, Instant now, OrderRow order, List<ItemRow> items,
            Summary summary) {
        ObjectNode results = F.objectNode();
        for (ItemRow item : items) {
            boolean waiting = "not-started".equals(item.status()) || "in-progress".equals(item.status());
            if ("employee".equals(item.owner()) || !waiting) continue;
            results.set(item.itemId(), callProvider(ctx, now, order, item));
        }
        boolean overdue = items.stream().anyMatch((i) -> DocumentView.overdue(i, now) && i.overdueRecordedAt() == null);
        if (results.isEmpty() && !overdue) {
            summary.orders.add(counts(order.orderUuid(), new int[6]));
            return;
        }
        ObjectNode input = F.objectNode();
        input.put("tickId", tickId);
        input.put("now", now.toString());
        input.set("results", results);
        Command command = new Command("documents.apply",
                commandId("documents:apply:", tickId, order.orderUuid(), Long.toString(order.version())), input);
        Outcome outcome;
        try {
            outcome = runner.execute(ctx, command, (tx) -> applyWork(tx, order.orderUuid(), now, results));
        } catch (RuntimeException e) {
            summary.blocked(order.orderUuid(), "progress", "unavailable");
            return;
        }
        if (outcome instanceof Outcome.Committed c) {
            summary.orders.add(c.result());
        } else {
            summary.blocked(order.orderUuid(), "progress", DocumentOutcome.from(outcome).status());
        }
    }

    /** The provider answer, tagged with the step it was asked at; a failure is unavailable, never a success. */
    private ObjectNode callProvider(RunContext ctx, Instant now, OrderRow order, ItemRow item) {
        ObjectNode result = F.objectNode().put("step", item.status());
        DocumentProviderPort.Operation op = new DocumentProviderPort.Operation(item.operationId(), ctx.runId(),
                order.orderUuid(), item.itemId(), item.fail(), item.failureReason(), order.openedAt(),
                item.progressAt());
        try {
            DocumentProviderPort.Result r = "not-started".equals(item.status()) ? provider.start(op)
                    : provider.progress(op, now);
            result.put("status", r == null || r.status() == null ? "unavailable" : r.status());
            result.put("providerReference", r == null ? null : r.providerReference());
            result.put("reason", r == null ? null : r.reason());
        } catch (RuntimeException e) {
            result.put("status", "unavailable");
        }
        return result;
    }

    private WorkResult applyWork(Tx tx, String orderUuid, Instant now, ObjectNode results) throws SQLException {
        Optional<OrderRow> locked = DocumentStore.orderForUpdate(tx, orderUuid);
        if (locked.isEmpty()) return WorkResult.refuse("document-order-missing", "The document order is not open.");
        OrderRow order = locked.get();
        int[] n = new int[6]; // started, completed, failed, overdue, unsupported, unavailable
        List<ItemRow> items = DocumentStore.items(tx, orderUuid);
        boolean changed = false;
        for (ItemRow item : items) {
            JsonNode r = results.get(item.itemId());
            if (r != null && r.path("step").asText().equals(item.status())) {
                String got = r.path("status").asText();
                if ("not-started".equals(item.status()) && "accepted".equals(got)) {
                    n[0]++;
                    update(tx, item, "in-progress", r.path("providerReference").asText(null), item.reason(), null,
                            item.lastProviderOutcome(), item.overdueRecordedAt());
                    changed = true;
                    continue;
                }
                if ("in-progress".equals(item.status()) && "complete".equals(got)) {
                    n[1]++;
                    update(tx, item, "complete", item.providerReference(), item.reason(), now,
                            item.lastProviderOutcome(), item.overdueRecordedAt());
                    changed = true;
                    continue;
                }
                if ("in-progress".equals(item.status()) && "failed".equals(got)) {
                    n[2]++;
                    String reason = r.path("reason").isTextual() ? r.path("reason").asText() : item.failureReason();
                    update(tx, item, "failed", item.providerReference(), reason, null, item.lastProviderOutcome(),
                            item.overdueRecordedAt());
                    exception(tx, order, item, order.exceptionTypes().path("failed").asText(), now);
                    changed = true;
                    continue;
                }
                if ("unsupported".equals(got) || "unavailable".equals(got)) {
                    n["unsupported".equals(got) ? 4 : 5]++;
                    if (!got.equals(item.lastProviderOutcome())) {
                        update(tx, item, item.status(), item.providerReference(), item.reason(), item.completedAt(),
                                got, item.overdueRecordedAt());
                        changed = true;
                    }
                    continue;
                }
            }
            if (DocumentView.overdue(item, now) && item.overdueRecordedAt() == null) {
                n[3]++;
                update(tx, item, item.status(), item.providerReference(), item.reason(), item.completedAt(),
                        item.lastProviderOutcome(), now);
                exception(tx, order, item, order.exceptionTypes().path("overdue").asText(), now);
                changed = true;
            }
        }
        if (changed) {
            tx.cas("UPDATE document_orders SET version = version + 1, updated_at = now() WHERE environment_id = ? "
                    + "AND run_id = ? AND order_uuid = ? AND version = ?", tx.context().environmentId(),
                    tx.context().runId(), orderUuid, order.version());
        }
        return WorkResult.ok(counts(orderUuid, n));
    }

    private static void update(Tx tx, ItemRow item, String status, String providerReference, String reason,
            Instant completedAt, String lastProviderOutcome, Instant overdueRecordedAt) throws SQLException {
        RunContext ctx = tx.context();
        tx.write("UPDATE document_items SET status = ?, provider_reference = ?, reason = ?, completed_at = ?, "
                + "last_provider_outcome = ?, overdue_recorded_at = ? WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ? AND item_id = ?", status, providerReference, reason, completedAt,
                lastProviderOutcome, overdueRecordedAt, ctx.environmentId(), ctx.runId(), item.orderUuid(),
                item.itemId());
    }

    /** The order's own slot and renewal travel with the event, never the employee's default slot. */
    private static void exception(Tx tx, OrderRow order, ItemRow item, String type, Instant now) {
        ObjectNode payload = F.objectNode();
        payload.put("employeeId", order.employeeId());
        payload.put("renewalId", order.renewalId());
        payload.put("orderUuid", order.orderUuid());
        payload.put("occurredAt", now.toString());
        payload.put("itemId", item.itemId());
        payload.put("exceptionType", type);
        payload.put("policyVersion", order.policyVersion());
        payload.set("lifecycleRevision", order.opening().path("lifecycleRevision"));
        payload.put("entitlementSlotId", order.entitlementSlotId());
        payload.put("renewalAuthority", order.renewalAuthority());
        payload.put("fictional", true);
        tx.emit("documents:" + order.orderUuid() + ":" + item.itemId() + ":" + type, type, payload);
    }

    private static ObjectNode counts(String orderUuid, int[] n) {
        ObjectNode node = F.objectNode().put("orderUuid", orderUuid);
        String[] names = {"started", "completed", "failed", "overdue", "unsupported", "unavailable"};
        for (int i = 0; i < names.length; i++) node.put(names[i], n[i]);
        return node;
    }

    /** Receipts hold ids up to 200 characters; a longer id is replaced by its digest, still stable per input. */
    private static String commandId(String prefix, String tickId, String orderUuid, String suffix) {
        String id = prefix + tickId + ":" + orderUuid + ":" + suffix;
        if (id.length() <= MAX_COMMAND_ID) return id;
        ArrayNode parts = F.arrayNode().add(tickId).add(orderUuid).add(suffix);
        return prefix + Canonical.digest(parts);
    }

    private static final class Summary {
        JsonNode producer = F.textNode("ok");
        int opened;
        final ArrayNode notOpen = F.arrayNode();
        final List<JsonNode> orders = new ArrayList<>();
        final ArrayNode blocked = F.arrayNode();
        final ArrayNode producerFailed = F.arrayNode();
        int producerFailedCount;

        void notOpen(String orderUuid, String reason) {
            notOpen.add(F.objectNode().put("orderUuid", orderUuid).put("reason", reason));
        }

        void blocked(String orderUuid, String step, String status) {
            blocked.add(F.objectNode().put("orderUuid", orderUuid).put("step", step).put("status", status));
        }

        void producerFailed(DocumentCasePort.OrderList listed) {
            List<JsonNode> failed = listed.failed() == null ? List.of() : listed.failed();
            for (JsonNode f : failed.stream().limit(MAX_FAILED_SHOWN).toList()) {
                producerFailed.add(F.objectNode().put("orderUuid", f.path("orderUuid").asText(null))
                        .put("status", f.path("status").asText(null)).put("code", f.path("code").asText(null)));
            }
            producerFailedCount = Math.max(listed.failedCount(), 0);
        }

        ObjectNode json() {
            ObjectNode node = F.objectNode();
            node.set("producer", producer);
            node.put("opened", opened);
            node.set("notOpen", notOpen);
            ArrayNode orderNodes = F.arrayNode();
            orders.forEach(orderNodes::add);
            node.set("orders", orderNodes);
            node.set("blocked", blocked);
            node.set("producerFailed", producerFailed);
            node.put("producerFailedCount", producerFailedCount);
            return node;
        }
    }
}
