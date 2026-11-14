package gcsp.api.documents;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/** Plain JDBC reads of the document tables, plus in-transaction reads that take the order lock. */
public final class DocumentStore {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SCOPE = "environment_id = ? AND run_id = ?";
    private static final String ORDER_COLUMNS = "run_id, order_uuid, employee_id, entitlement_slot_id, renewal_id, "
            + "renewal_authority, policy_version, opened_at, opening::text, last_observed_revision, provider_mode, "
            + "exception_types::text, assumptions::text, version";
    private static final String ITEM_COLUMNS = "order_uuid, item_id, position, kind, label, owner, action, status, "
            + "due_at, progress_at, operation_id, fail, failure_reason, provider_reference, reason, completed_at, "
            + "acknowledgement::text, last_provider_outcome, overdue_recorded_at, assumption::text";
    private static final String ITEM_ORDER = " ORDER BY order_uuid, position";

    /** The predicate matches the document_items_open partial index exactly. */
    static final String OPEN_ORDERS_SQL = "SELECT DISTINCT order_uuid FROM document_items WHERE " + SCOPE
            + " AND status IN ('not-started', 'in-progress', 'waiting-for-employee', 'acknowledging')"
            + " ORDER BY order_uuid";

    /** The documents store could not be read; callers answer unavailable rather than guess. */
    public static final class StoreUnavailable extends RuntimeException {
        StoreUnavailable(Throwable cause) {
            super("The document store could not be read", cause);
        }
    }

    public record OrderRow(String runId, String orderUuid, String employeeId, String entitlementSlotId, String renewalId,
            String renewalAuthority, String policyVersion, Instant openedAt, JsonNode opening,
            long lastObservedRevision, String providerMode, JsonNode exceptionTypes, JsonNode assumptions,
            long version) {}

    public record ItemRow(String orderUuid, String itemId, int position, String kind, String label, String owner,
            String action, String status, Instant dueAt, Instant progressAt, String operationId, boolean fail,
            String failureReason, String providerReference, String reason, Instant completedAt,
            JsonNode acknowledgement, String lastProviderOutcome, Instant overdueRecordedAt, JsonNode assumption) {}

    /** The durable provider call behind an acknowledgement: its state and the version finalizing must match. */
    public record OperationRow(String operationId, String state, long version, JsonNode outcome) {}

    private final DataSource dataSource;

    public DocumentStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Optional<OrderRow> order(RunContext ctx, String orderUuid) {
        List<OrderRow> rows = orders(ctx, List.of(orderUuid));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** One query for any number of orders, in order_uuid order. */
    public List<OrderRow> orders(RunContext ctx, Collection<String> orderUuids) {
        if (orderUuids.isEmpty()) return List.of();
        return query("SELECT " + ORDER_COLUMNS + " FROM document_orders WHERE " + SCOPE
                + " AND order_uuid = ANY(?) ORDER BY order_uuid", DocumentStore::orderRow, ctx, orderUuids);
    }

    public List<OrderRow> ordersFor(RunContext ctx, String employeeId) {
        return query("SELECT " + ORDER_COLUMNS + " FROM document_orders WHERE " + SCOPE
                + " AND employee_id = ? ORDER BY opened_at, order_uuid", DocumentStore::orderRow, ctx, employeeId);
    }

    /** One query for every order's items, grouped by order and in policy position. */
    public Map<String, List<ItemRow>> items(RunContext ctx, Collection<String> orderUuids) {
        Map<String, List<ItemRow>> grouped = new LinkedHashMap<>();
        if (orderUuids.isEmpty()) return grouped;
        for (ItemRow item : query("SELECT " + ITEM_COLUMNS + " FROM document_items WHERE " + SCOPE
                + " AND order_uuid = ANY(?)" + ITEM_ORDER, DocumentStore::itemRow, ctx, orderUuids)) {
            grouped.computeIfAbsent(item.orderUuid(), (k) -> new ArrayList<>()).add(item);
        }
        return grouped;
    }

    public Optional<OperationRow> operation(RunContext ctx, String operationId) {
        List<OperationRow> rows = query("SELECT operation_id, state, version, outcome::text FROM pending_operations "
                + "WHERE " + SCOPE + " AND operation_id = ?", (rs) -> new OperationRow(rs.getString(1),
                rs.getString(2), rs.getLong(3), json(rs.getString(4))), ctx, operationId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<String> ordersWithOpenItems(RunContext ctx) {
        return query(OPEN_ORDERS_SQL, (rs) -> rs.getString(1), ctx);
    }

    /** The order row locked for the rest of the transaction; empty when it does not exist. */
    public static Optional<OrderRow> orderForUpdate(Tx tx, String orderUuid) throws SQLException {
        RunContext ctx = tx.context();
        return tx.first("SELECT " + ORDER_COLUMNS + " FROM document_orders WHERE " + SCOPE
                + " AND order_uuid = ? FOR UPDATE", DocumentStore::orderRow, ctx.environmentId(), ctx.runId(),
                orderUuid);
    }

    public static List<ItemRow> items(Tx tx, String orderUuid) throws SQLException {
        RunContext ctx = tx.context();
        List<ItemRow> items = new ArrayList<>();
        try (PreparedStatement ps = tx.connection().prepareStatement("SELECT " + ITEM_COLUMNS
                + " FROM document_items WHERE " + SCOPE + " AND order_uuid = ?" + ITEM_ORDER)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) items.add(itemRow(rs));
            }
        }
        return items;
    }

    private <T> List<T> query(String sql, Tx.RowMapper<T> mapper, RunContext ctx, Object... params) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            for (int i = 0; i < params.length; i++) {
                Object p = params[i];
                if (p instanceof Collection<?> values) {
                    Array array = c.createArrayOf("text", values.toArray());
                    ps.setArray(i + 3, array);
                } else {
                    ps.setObject(i + 3, p);
                }
            }
            List<T> rows = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(mapper.map(rs));
            }
            return rows;
        } catch (SQLException e) {
            throw new StoreUnavailable(e);
        }
    }

    private static OrderRow orderRow(ResultSet rs) throws SQLException {
        return new OrderRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), instant(rs, 8), json(rs.getString(9)), rs.getLong(10),
                rs.getString(11), json(rs.getString(12)), json(rs.getString(13)), rs.getLong(14));
    }

    private static ItemRow itemRow(ResultSet rs) throws SQLException {
        return new ItemRow(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), instant(rs, 9), instant(rs, 10), rs.getString(11),
                rs.getBoolean(12), rs.getString(13), rs.getString(14), rs.getString(15), instant(rs, 16),
                json(rs.getString(17)), rs.getString(18), instant(rs, 19), json(rs.getString(20)));
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static JsonNode json(String text) throws SQLException {
        if (text == null) return null;
        try {
            return JSON.readTree(text);
        } catch (JsonProcessingException e) {
            throw new SQLException("Stored JSON could not be read", e);
        }
    }
}
