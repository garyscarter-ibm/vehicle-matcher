package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.approvals.ApprovalResult;
import gcsp.api.approvals.ApprovalService;
import gcsp.api.approvals.ApprovalServiceHolder;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.auth.Role;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** The documents case port over the approvals read model, the selection owner and the employee and slot tables. */
@ApplicationScoped
public class LifecycleDocumentCases implements DocumentCasePort {

    private static final ApprovalService.Reader SYSTEM = new ApprovalService.Reader(Role.PRESENTER, null);
    private static final int PAGE = 100;
    private static final int MAX_PAGES = 10_000;
    private static final String UNAVAILABLE = "approvals-unavailable";
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    @Inject
    ApprovalServiceHolder approvals;

    @Inject
    OrderSourcePort orders;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Override
    public StageRead readStage(RunContext ctx, String orderUuid) {
        try {
            Optional<ApprovalService> service = approvals.service();
            if (service.isEmpty()) return new StageRead("unavailable", UNAVAILABLE, null);
            return stage(service.get().read(ctx, SYSTEM, orderUuid));
        } catch (RuntimeException e) {
            return new StageRead("unavailable", UNAVAILABLE, null);
        }
    }

    @Override
    public OrderList listOrders(RunContext ctx) {
        try {
            Optional<ApprovalService> service = approvals.service();
            if (service.isEmpty()) return unavailableList(UNAVAILABLE);
            List<String> uuids = new ArrayList<>();
            List<JsonNode> failed = new ArrayList<>();
            int failedCount = 0;
            String after = null;
            for (int page = 0; page < MAX_PAGES; page++) {
                ApprovalResult result = service.get().list(ctx, SYSTEM, after, PAGE);
                if (!(result instanceof ApprovalResult.Ok ok)) return unavailableList(result.code());
                JsonNode v = ok.value();
                for (JsonNode o : v.path("orders")) uuids.add(o.path("orderUuid").asText());
                for (JsonNode f : v.path("failed")) failed.add(f);
                failedCount += v.path("failedCount").asInt(0);
                String next = v.hasNonNull("nextAfter") ? v.get("nextAfter").asText() : null;
                if (next == null) return new OrderList("ok", null, uuids, failed, failedCount);
                if (next.equals(after)) return unavailableList("order-cursor-stalled");
                after = next;
            }
            return unavailableList("order-cursor-stalled");
        } catch (RuntimeException e) {
            return unavailableList(UNAVAILABLE);
        }
    }

    @Override
    public CaseCheck checkCase(RunContext ctx, String employeeId, OrderAuthority order) {
        if (!persistence.active()) return new CaseCheck.Unavailable("case-check-failed");
        try (Connection c = dataSource.get().getConnection()) {
            return check(c, ctx, employeeId, order);
        } catch (SQLException | RuntimeException e) {
            return new CaseCheck.Unavailable("case-check-failed");
        }
    }

    /** The Node #orderOwner checks over the employee and slot rows: no default-slot fallback. */
    static CaseCheck check(Connection c, RunContext ctx, String employeeId, OrderAuthority order) throws SQLException {
        String employee = null;
        try (PreparedStatement ps = c.prepareStatement("SELECT attributes::text FROM employees WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) employee = rs.getString(1);
            }
        }
        if (employee == null) return new CaseCheck.Refused("stage-employee-unknown");
        JsonNode scheme = json(employee).get("schemeId");
        String schemeId = scheme != null && scheme.isTextual() ? scheme.asText() : null;
        if (order.entitlementSlotId() == null) return new CaseCheck.Valid(schemeId);
        JsonNode slot = null;
        try (PreparedStatement ps = c.prepareStatement("SELECT employee_id, attributes::text FROM entitlement_slots "
                + "WHERE environment_id = ? AND run_id = ? AND slot_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, order.entitlementSlotId());
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next() && employeeId.equals(rs.getString(1))) slot = json(rs.getString(2));
            }
        }
        if (slot == null) return new CaseCheck.Refused("stage-slot-mismatch");
        JsonNode renewal = slot.get("renewalId");
        if (order.renewalId() != null && renewal != null && renewal.isTextual() && !renewal.asText().isBlank()
                && !renewal.asText().equals(order.renewalId())) {
            return new CaseCheck.Refused("stage-renewal-mismatch");
        }
        return new CaseCheck.Valid(schemeId);
    }

    @Override
    public Owner ownerOf(RunContext ctx, String orderUuid) {
        try {
            return owner(orders.find(ctx, orderUuid));
        } catch (RuntimeException e) {
            return new Owner.Unavailable("order-source-failed");
        }
    }

    /** One approvals answer as a lifecycle.stages.v1 read; every non-readable answer keeps its own status. */
    static StageRead stage(ApprovalResult result) {
        return switch (result) {
            case ApprovalResult.Ok ok -> new StageRead("ok", null, ok.value());
            case ApprovalResult.NotFound n -> new StageRead("not-found", n.code(), null);
            case ApprovalResult.Forbidden f -> new StageRead("forbidden", f.code(), null);
            case ApprovalResult.Unavailable u -> new StageRead("unavailable", u.code(), null);
            case ApprovalResult.Invalid i -> new StageRead("invalid", i.code(), null);
            case ApprovalResult.Conflict c -> new StageRead("conflict", c.code(), null);
            case ApprovalResult.Uncertain u -> new StageRead("unavailable", u.code(), null);
        };
    }

    /** The selection order's owner; an unreadable or doubled record still names its employee. */
    static Owner owner(OrderSourcePort.Found found) {
        return switch (found) {
            case OrderSourcePort.Ready r -> new Owner.Owned(r.order().employeeId());
            case OrderSourcePort.NotReady n -> new Owner.Owned(n.employeeId());
            case OrderSourcePort.Invalid i -> new Owner.Owned(i.employeeId());
            case OrderSourcePort.Duplicate d -> new Owner.Owned(d.employeeId());
            case OrderSourcePort.NotFound n -> new Owner.NotFound();
            case OrderSourcePort.Unavailable u -> new Owner.Unavailable(u.code());
        };
    }

    private static OrderList unavailableList(String code) {
        return new OrderList("unavailable", code, List.of(), List.of(), 0);
    }

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
