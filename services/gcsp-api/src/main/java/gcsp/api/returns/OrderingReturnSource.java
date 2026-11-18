package gcsp.api.returns;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * The return source over the FUCQ-468 selection record. The manual route reads the exact draft the selection pinned;
 * the buddy route reads the employee's current contract. Read only, at most three indexed queries.
 */
@ApplicationScoped
public class OrderingReturnSource implements ReturnSourcePort {

    private static final String PENDING = "selection-pending";
    private static final String HEAD_SQL = "SELECT s.employee_id, s.entitlement_slot_id, s.source_type, s.operation_id, "
            + "s.received_at, s.selection::text, p.state FROM selection_orders s JOIN pending_operations p "
            + "ON p.environment_id = s.environment_id AND p.run_id = s.run_id AND p.operation_id = s.operation_id "
            + "WHERE s.environment_id = ? AND s.run_id = ? AND s.order_uuid = ? ORDER BY s.operation_id LIMIT 3";
    private static final String DRAFT_SQL = "SELECT value::text FROM manual_drafts WHERE environment_id = ? AND run_id = ? "
            + "AND employee_id = ? AND draft_version = ?";
    private static final String ACCOUNT_SQL = "SELECT record::text FROM employee_account_records WHERE environment_id = ? "
            + "AND run_id = ? AND employee_id = ?";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    /** The selection row's own columns; buddy is source_type 'buddy-offer', and selection is its immutable snapshot. */
    record Head(String orderUuid, String employeeId, String slotId, boolean buddy, String operationId, Instant receivedAt,
            JsonNode selection) {}

    @Override
    public String mode() {
        return persistence.active() ? "ordering" : "none";
    }

    @Override
    public ReturnSourceReading read(RunContext ctx, String orderUuid) {
        if (!persistence.active()) return unavailable();
        try (Connection c = dataSource.get().getConnection()) {
            List<Head> acknowledged = new ArrayList<>();
            boolean open = false;
            int rows = 0;
            try (PreparedStatement ps = c.prepareStatement(HEAD_SQL)) {
                ps.setString(1, ctx.environmentId());
                ps.setString(2, ctx.runId());
                ps.setString(3, orderUuid);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        rows++;
                        String state = rs.getString(7);
                        if ("acknowledged".equals(state)) {
                            acknowledged.add(new Head(orderUuid, rs.getString(1), rs.getString(2),
                                    "buddy-offer".equals(rs.getString(3)), rs.getString(4),
                                    rs.getObject(5, OffsetDateTime.class).toInstant(), ReturnJson.JSON.readTree(rs.getString(6))));
                        } else if ("intent".equals(state) || "pending".equals(state)) {
                            open = true;
                        }
                    }
                }
            }
            if (rows == 0) return new ReturnSourceReading.NotFound();
            if (acknowledged.size() > 1) return ReturnSourceReading.invalid();
            if (acknowledged.isEmpty()) {
                return open ? new ReturnSourceReading.Unavailable(PENDING, true, "The order has not been confirmed yet.")
                        : ReturnSourceReading.invalid();
            }
            Head head = acknowledged.get(0);
            if (!needsRecord(head)) return map(head, null);
            JsonNode record = head.buddy() ? account(c, ctx, head) : draft(c, ctx, head);
            return record == null ? ReturnSourceReading.invalid() : map(head, record);
        } catch (JsonProcessingException e) {
            return ReturnSourceReading.invalid();
        } catch (SQLException | RuntimeException e) {
            return unavailable();
        }
    }

    private static ReturnSourceReading unavailable() {
        return new ReturnSourceReading.Unavailable(UnconfiguredReturnSource.CODE, true,
                "The record of your current car is not available yet.");
    }

    private static JsonNode draft(Connection c, RunContext ctx, Head head) throws SQLException, JsonProcessingException {
        JsonNode version = head.selection().path("source").path("expectedDraftVersion");
        if (!version.isIntegralNumber() || !version.canConvertToLong()) return null;
        return one(c, DRAFT_SQL, ctx, head.employeeId(), version.longValue());
    }

    private static JsonNode account(Connection c, RunContext ctx, Head head) throws SQLException, JsonProcessingException {
        return one(c, ACCOUNT_SQL, ctx, head.employeeId(), null);
    }

    private static JsonNode one(Connection c, String sql, RunContext ctx, String employeeId, Long version)
            throws SQLException, JsonProcessingException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, employeeId);
            if (version != null) ps.setLong(4, version);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? ReturnJson.JSON.readTree(rs.getString(1)) : null;
            }
        }
    }

    /** True when the selection is a replacement, which alone needs the draft (manual) or account record (buddy). */
    static boolean needsRecord(Head head) {
        JsonNode s = head.selection();
        return head.buddy() ? s.path("sourceVersions").path("returnOdometer").isObject()
                : "replacement".equals(s.path("draft").path("mode").asText(null));
    }

    /** The source from the frozen selection and the record needsRecord asks for; invalid when anything is unusable. */
    static ReturnSourceReading map(Head head, JsonNode record) {
        JsonNode s = head.selection();
        if (!s.isObject()) return ReturnSourceReading.invalid();
        String configurationId = s.path("stock").path("configurationId").asText(null);
        ReturnSource source;
        if (!needsRecord(head)) {
            boolean mode = head.buddy() ? s.path("sourceVersions").path("returnOdometer").isNull()
                    || s.path("sourceVersions").path("returnOdometer").isMissingNode()
                    : "new".equals(s.path("draft").path("mode").asText(null));
            if (!mode) return ReturnSourceReading.invalid();
            source = new ReturnSource(head.orderUuid(), head.employeeId(), false, null, null, null, null, head.buddy(), null,
                    null, head.operationId(), head.receivedAt(), configurationId);
        } else if (record == null || !record.isObject()) {
            return ReturnSourceReading.invalid();
        } else {
            source = head.buddy() ? buddy(head, record, configurationId) : manual(head, record, configurationId);
        }
        return source != null && source.valid() ? new ReturnSourceReading.Found(source) : ReturnSourceReading.invalid();
    }

    private static ReturnSource manual(Head head, JsonNode draft, String configurationId) {
        JsonNode choices = draft.path("choices");
        JsonNode contract = draft.path("currentContract");
        if (!"replacement".equals(choices.path("mode").asText(null)) || !contract.isObject()) return null;
        String contractId = contract.path("contractId").asText(null);
        if (contractId == null || !contractId.equals(choices.path("oldContractId").asText(null))) return null;
        JsonNode details = head.selection().path("reviewDetails").path("details");
        JsonNode mileage = details.isObject() ? details.path("expectedReturnMileage") : choices.path("expectedReturnMileage");
        if (!mileage.isIntegralNumber() || !mileage.canConvertToLong()) return null;
        return replacement(head, contract, choices.path("collectionLocationId").asText(null), false, mileage.longValue(),
                "mi", configurationId);
    }

    private static ReturnSource buddy(Head head, JsonNode account, String configurationId) {
        JsonNode odometer = head.selection().path("sourceVersions").path("returnOdometer");
        JsonNode contract = currentContract(account.path("contracts"), head.slotId());
        JsonNode value = odometer.path("value");
        if (contract == null || !value.isIntegralNumber() || !value.canConvertToLong()) return null;
        return replacement(head, contract, null, true, value.longValue(), odometer.path("unit").asText(null), configurationId);
    }

    private static ReturnSource replacement(Head head, JsonNode contract, String locationId, boolean buddy, long mileage,
            String unit, String configurationId) {
        String slot = contract.path("slotId").asText(null);
        return new ReturnSource(head.orderUuid(), head.employeeId(), true, contract.path("contractId").asText(null),
                head.slotId(), slot == null ? head.slotId() : slot, locationId, buddy, mileage, unit, head.operationId(),
                head.receivedAt(), configurationId);
    }

    /** The employee's current contract for the slot with no returned date, as the buddy conversion picked it. */
    private static JsonNode currentContract(JsonNode contracts, String slotId) {
        if (!contracts.isArray()) return null;
        for (JsonNode c : contracts) {
            if ("current".equals(c.path("status").asText()) && slotId.equals(c.path("slotId").asText(null))
                    && (c.path("returnedDate").isMissingNode() || c.path("returnedDate").isNull())) {
                return c;
            }
        }
        return null;
    }
}
