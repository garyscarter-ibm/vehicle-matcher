package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.ordering.OrderingProjection.Row;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;

/** The acknowledged selection orders as approvals reads them: found by the order_uuid index, listed keyset by it. */
public final class OrderingOrderSource implements OrderSourcePort {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String DOWN = "order-source-unavailable";

    private final DataSource dataSource;

    public OrderingOrderSource(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public String mode() {
        return "ordering";
    }

    @Override
    public Found find(RunContext ctx, String orderUuid) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                OrderingService.selectRow() + "WHERE s.environment_id = ? AND s.run_id = ? AND s.order_uuid = ? "
                        + "ORDER BY s.operation_id LIMIT 3")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, orderUuid);
            List<Row> rows = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(OrderingService.map(rs));
            }
            if (rows.isEmpty()) return new NotFound();
            List<Row> acknowledged = rows.stream().filter(r -> "acknowledged".equals(r.state())).toList();
            if (acknowledged.size() > 1) return new Duplicate(acknowledged.get(0).employeeId());
            Row r = acknowledged.isEmpty() ? rows.get(0) : acknowledged.get(0);
            if (r.open()) return new NotReady(r.employeeId(), "selection-pending", "The selection is still being sent on.");
            if ("refused".equals(r.state())) {
                return new NotReady(r.employeeId(), "selection-handoff-failed", "The selection was not accepted for ordering.");
            }
            SelectionOrder o = decode(r);
            return o == null ? new Invalid(r.employeeId()) : new Ready(o);
        } catch (SQLException | RuntimeException e) {
            return new Unavailable(DOWN);
        }
    }

    @Override
    public Listing list(RunContext ctx, String after, int limit) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                OrderingService.selectRow() + "WHERE s.environment_id = ? AND s.run_id = ? AND p.state = 'acknowledged' "
                        + "AND s.order_uuid > ? ORDER BY s.order_uuid, s.operation_id LIMIT ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, after == null ? "" : after);
            ps.setInt(4, limit);
            List<SelectionOrder> orders = new ArrayList<>();
            List<InvalidRow> invalid = new ArrayList<>();
            String last = null;
            int seen = 0;
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Row r = OrderingService.map(rs);
                    seen++;
                    last = r.orderUuid();
                    SelectionOrder o = decode(r);
                    if (o == null) invalid.add(new InvalidRow(r.orderUuid(), r.employeeId()));
                    else orders.add(o);
                }
            }
            return new Page(orders, invalid, seen == limit ? last : null);
        } catch (SQLException | RuntimeException e) {
            return new Unavailable(DOWN);
        }
    }

    /** Mirrors Node decodeSelectionOrder; null when the stored snapshot or provider outcome is not usable. */
    private static SelectionOrder decode(Row r) {
        JsonNode s = r.selection();
        JsonNode out = r.outcome();
        JsonNode stages = s.path("terms").path("approvalStages");
        String received = s.path("receivedAt").asText(null);
        if (out == null || !"confirmed".equals(out.path("status").asText()) || !r.operationId().equals(out.path("operationId").asText())
                || !r.orderUuid().equals(out.path("orderUuid").asText()) || !r.orderUuid().equals(s.path("stock").path("orderUuid").asText())
                || r.providerReference() == null || !stages.isArray() || stages.isEmpty() || received == null
                || !s.path("terms").path("policyVersion").isTextual()) {
            return null;
        }
        Instant at;
        try {
            at = Instant.parse(received);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
        String route = "cart".equals(r.sourceType()) ? "manual" : "buddy-offer".equals(r.sourceType()) ? "buddy" : null;
        if (route == null) return null;
        List<String> names = new ArrayList<>();
        stages.forEach(n -> names.add(n.asText()));
        ObjectNode src = JSON.createObjectNode();
        src.put("operationId", r.operationId());
        src.put("operationType", OrderingService.TYPE);
        src.put("sourceType", r.sourceType());
        src.put("holdId", r.holdId());
        src.put("orderNumber", out.path("orderNumber").asText(s.path("stock").path("orderNumber").asText(null)));
        src.put("orderReference", r.orderReference());
        src.put("configurationId", out.path("configurationId").asText(s.path("stock").path("configurationId").asText(null)));
        src.put("receivedAt", received);
        src.put("quoteId", s.path("quote").path("quoteId").asText(null));
        src.put("termsVersion", s.path("terms").path("termsVersion").asText(null));
        src.put("termsDigest", s.path("terms").path("termsDigest").asText(null));
        src.set("approvalStages", stages.deepCopy());
        src.put("policyVersion", s.path("terms").path("policyVersion").asText());
        src.put("operationVersion", r.version());
        src.put("providerReference", r.providerReference());
        JsonNode renewal = s.path("renewalId");
        return new SelectionOrder(r.orderUuid(), r.employeeId(), r.slotId(), renewal.isTextual() ? renewal.asText() : null,
                route, src, names, s.path("terms").path("policyVersion").asText(), at, r.operationId(), r.providerReference());
    }
}
