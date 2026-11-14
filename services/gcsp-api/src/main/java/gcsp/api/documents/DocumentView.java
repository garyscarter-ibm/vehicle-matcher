package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.documents.DocumentStore.ItemRow;
import gcsp.api.documents.DocumentStore.OrderRow;
import java.time.Instant;
import java.util.List;

/** Pure projections of stored orders and items: the employee-facing view, readiness and overdue. */
public final class DocumentView {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private DocumentView() {}

    /** Ready needs every document and readiness item complete; an order with no items is never ready. */
    public static ObjectNode readiness(List<ItemRow> items) {
        boolean documentsComplete = items.stream().filter((i) -> "document".equals(i.kind()))
                .allMatch((i) -> "complete".equals(i.status()));
        boolean vehicleReady = items.stream().filter((i) -> "readiness".equals(i.kind()))
                .allMatch((i) -> "complete".equals(i.status()));
        boolean ready = documentsComplete && vehicleReady && !items.isEmpty();
        ArrayNode blocking = F.arrayNode();
        ArrayNode failed = F.arrayNode();
        for (ItemRow item : items) {
            if (!"complete".equals(item.status())) blocking.add(item.itemId());
            if ("failed".equals(item.status())) failed.add(item.itemId());
        }
        ObjectNode node = F.objectNode();
        node.put("ready", ready);
        node.put("state", ready ? "ready" : failed.isEmpty() ? "waiting" : "failed");
        node.put("documentsComplete", documentsComplete);
        node.put("vehicleReady", vehicleReady);
        node.set("blocking", blocking);
        node.set("failed", failed);
        return node;
    }

    public static boolean overdue(ItemRow item, Instant now) {
        return "employee".equals(item.owner()) && !"complete".equals(item.status())
                && !"failed".equals(item.status()) && now.isAfter(item.dueAt());
    }

    /** Never carries operation ids, failure scenario flags or progress timing. */
    public static ObjectNode present(OrderRow order, List<ItemRow> items, Instant now,
            boolean acknowledgementSupported) {
        ArrayNode itemNodes = F.arrayNode();
        ArrayNode tasks = F.arrayNode();
        for (ItemRow item : items) {
            boolean overdue = overdue(item, now);
            ObjectNode node = itemNodes.addObject();
            node.put("itemId", item.itemId());
            node.put("kind", item.kind());
            node.put("label", item.label());
            node.put("owner", item.owner());
            if (item.action() != null) node.put("action", item.action());
            node.put("status", item.status());
            node.put("dueAt", item.dueAt().toString());
            node.put("providerReference", item.providerReference());
            node.put("reason", item.reason());
            node.put("completedAt", item.completedAt() == null ? null : item.completedAt().toString());
            node.set("acknowledgement", ack(item));
            node.set("assumption", item.assumption());
            node.put("overdue", overdue);
            if ("employee".equals(item.owner())) {
                ObjectNode task = tasks.addObject();
                task.put("itemId", item.itemId());
                task.put("label", item.label());
                task.put("action", item.action());
                task.put("status", item.status());
                task.put("dueAt", item.dueAt().toString());
                task.put("overdue", overdue);
                task.put("actionable", "waiting-for-employee".equals(item.status()) && acknowledgementSupported);
                task.set("acknowledgement", ack(item));
            }
        }
        ObjectNode view = F.objectNode();
        view.put("contractVersion", DocumentService.CONTRACT);
        view.put("runId", order.runId());
        view.put("orderUuid", order.orderUuid());
        view.put("employeeId", order.employeeId());
        view.put("documentsRevision", order.version());
        view.put("policyVersion", order.policyVersion());
        view.put("openedAt", order.openedAt().toString());
        view.set("opening", order.opening());
        view.put("lastObservedRevision", order.lastObservedRevision());
        view.put("providerMode", order.providerMode());
        view.put("acknowledgementSupported", acknowledgementSupported);
        view.set("items", itemNodes);
        view.set("tasks", tasks);
        view.set("readiness", readiness(items));
        view.set("assumptions", order.assumptions());
        view.put("fictional", true);
        return view;
    }

    private static JsonNode ack(ItemRow item) {
        return item.acknowledgement() == null ? F.nullNode() : item.acknowledgement();
    }
}
