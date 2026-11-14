package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** One return_plans row; every statement here keys on the order's primary key, apart from the progress page. */
final class PlanRow {

    static final String COLUMNS = "order_uuid, employee_id, old_contract_id, entitlement_slot_id, source_reference, choice, "
            + "location::text, policy_version, provider_mode, state, requested_slot::text, slot::text, proposed_slot::text, "
            + "proposal_id, accepted_proposal_id, confirmation::text, history::text, request_operation_id, "
            + "confirm_operation_id, accept_operation_id, pending_step, pending_operation_id, pending_last_known, "
            + "blocked_step, blocked_code, blocked_reason, version";
    private static final String READ = "SELECT " + COLUMNS + " FROM return_plans "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?";
    /** The predicate repeats the return_plans_progress partial index so the page reads only plans with work left. */
    private static final String PAGE = "SELECT " + COLUMNS + " FROM return_plans WHERE environment_id = ? AND run_id = ? "
            + "AND order_uuid > ? AND (state IN ('requested', 'scheduled') OR pending_operation_id IS NOT NULL) "
            + "ORDER BY order_uuid LIMIT ?";

    String orderUuid, employeeId, oldContractId, entitlementSlotId, sourceReference, choice, policyVersion, providerMode, state;
    JsonNode location, confirmation;
    AppointmentSlot requestedSlot, slot, proposedSlot;
    String proposalId, acceptedProposalId, requestOperationId, confirmOperationId, acceptOperationId;
    String pendingStep, pendingOperationId, pendingLastKnown, blockedStep, blockedCode, blockedReason;
    ArrayNode history;
    long version;

    static PlanRow read(Connection c, RunContext ctx, String orderUuid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(READ)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    static PlanRow read(Tx tx, String orderUuid) throws SQLException {
        RunContext c = tx.context();
        return tx.first(READ, PlanRow::map, c.environmentId(), c.runId(), orderUuid).orElse(null);
    }

    /** One keyset page after {@code afterOrderUuid}, in order_uuid order. */
    static List<PlanRow> page(Connection c, RunContext ctx, String afterOrderUuid, int limit) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(PAGE)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, afterOrderUuid);
            ps.setInt(4, limit);
            List<PlanRow> rows = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(map(rs));
            }
            return rows;
        }
    }

    static PlanRow map(ResultSet rs) throws SQLException {
        try {
            PlanRow r = new PlanRow();
            r.orderUuid = rs.getString(1);
            r.employeeId = rs.getString(2);
            r.oldContractId = rs.getString(3);
            r.entitlementSlotId = rs.getString(4);
            r.sourceReference = rs.getString(5);
            r.choice = rs.getString(6);
            r.location = ReturnJson.JSON.readTree(rs.getString(7));
            r.policyVersion = rs.getString(8);
            r.providerMode = rs.getString(9);
            r.state = rs.getString(10);
            r.requestedSlot = slot(rs.getString(11));
            r.slot = slot(rs.getString(12));
            r.proposedSlot = slot(rs.getString(13));
            r.proposalId = rs.getString(14);
            r.acceptedProposalId = rs.getString(15);
            r.confirmation = ReturnJson.JSON.readTree(rs.getString(16));
            r.history = (ArrayNode) ReturnJson.JSON.readTree(rs.getString(17));
            r.requestOperationId = rs.getString(18);
            r.confirmOperationId = rs.getString(19);
            r.acceptOperationId = rs.getString(20);
            r.pendingStep = rs.getString(21);
            r.pendingOperationId = rs.getString(22);
            r.pendingLastKnown = rs.getString(23);
            r.blockedStep = rs.getString(24);
            r.blockedCode = rs.getString(25);
            r.blockedReason = rs.getString(26);
            r.version = rs.getLong(27);
            return r;
        } catch (IOException | ClassCastException e) {
            throw new SQLException("Stored return plan is unreadable");
        }
    }

    private static AppointmentSlot slot(String json) throws IOException {
        return json == null ? null : AppointmentSlot.fromJson(ReturnJson.JSON.readTree(json));
    }

    PlanRow copy() {
        PlanRow c = new PlanRow();
        c.orderUuid = orderUuid;
        c.employeeId = employeeId;
        c.oldContractId = oldContractId;
        c.entitlementSlotId = entitlementSlotId;
        c.sourceReference = sourceReference;
        c.choice = choice;
        c.location = location;
        c.policyVersion = policyVersion;
        c.providerMode = providerMode;
        c.state = state;
        c.confirmation = confirmation;
        c.requestedSlot = requestedSlot;
        c.slot = slot;
        c.proposedSlot = proposedSlot;
        c.proposalId = proposalId;
        c.acceptedProposalId = acceptedProposalId;
        c.requestOperationId = requestOperationId;
        c.confirmOperationId = confirmOperationId;
        c.acceptOperationId = acceptOperationId;
        c.pendingStep = pendingStep;
        c.pendingOperationId = pendingOperationId;
        c.pendingLastKnown = pendingLastKnown;
        c.blockedStep = blockedStep;
        c.blockedCode = blockedCode;
        c.blockedReason = blockedReason;
        c.history = history.deepCopy();
        c.version = version;
        return c;
    }

    void setPending(String step, String operationId, String lastKnown) {
        pendingStep = step;
        pendingOperationId = operationId;
        pendingLastKnown = lastKnown;
    }

    void clearPending() {
        setPending(null, null, null);
    }

    void setBlocked(String step, String code, String reason) {
        blockedStep = step;
        blockedCode = code;
        blockedReason = reason;
    }

    void clearBlocked() {
        setBlocked(null, null, null);
    }

    /** True when any column the settle and open steps change differs from {@code o}. */
    boolean differsFrom(PlanRow o) {
        return !Objects.equals(state, o.state) || !Objects.equals(slot, o.slot) || !Objects.equals(proposedSlot, o.proposedSlot)
                || !Objects.equals(proposalId, o.proposalId) || !Objects.equals(acceptedProposalId, o.acceptedProposalId)
                || !Objects.equals(history, o.history) || !Objects.equals(confirmOperationId, o.confirmOperationId)
                || !Objects.equals(acceptOperationId, o.acceptOperationId) || !Objects.equals(pendingStep, o.pendingStep)
                || !Objects.equals(pendingOperationId, o.pendingOperationId)
                || !Objects.equals(pendingLastKnown, o.pendingLastKnown) || !Objects.equals(blockedStep, o.blockedStep)
                || !Objects.equals(blockedCode, o.blockedCode) || !Objects.equals(blockedReason, o.blockedReason);
    }

    static void insert(Tx tx, PlanRow r, ReturnSource source) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO return_plans (environment_id, run_id, order_uuid, employee_id, old_contract_id, "
                + "entitlement_slot_id, source_reference, source_received_at, choice, location, policy_version, "
                + "provider_mode, state, requested_slot, confirmation, request_operation_id, pending_step, "
                + "pending_operation_id, pending_last_known) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not-requested', "
                + "?, ?, ?, 'request', ?, 'requesting')", c.environmentId(), c.runId(), r.orderUuid, r.employeeId,
                r.oldContractId, r.entitlementSlotId, r.sourceReference, source.receivedAt(), r.choice, r.location,
                r.policyVersion, r.providerMode, r.requestedSlot.toJson(), r.confirmation, r.requestOperationId,
                r.requestOperationId);
    }

    /** Writes this row's mutable columns if the stored version is still {@code expectedVersion}; else stale-version. */
    void update(Tx tx, long expectedVersion) throws SQLException {
        RunContext c = tx.context();
        tx.cas("UPDATE return_plans SET state = ?, slot = ?, proposed_slot = ?, proposal_id = ?, accepted_proposal_id = ?, "
                + "history = ?, confirm_operation_id = ?, accept_operation_id = ?, pending_step = ?, "
                + "pending_operation_id = ?, pending_last_known = ?, blocked_step = ?, blocked_code = ?, "
                + "blocked_reason = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?", state,
                slot == null ? null : slot.toJson(), proposedSlot == null ? null : proposedSlot.toJson(), proposalId,
                acceptedProposalId, history, confirmOperationId, acceptOperationId, pendingStep, pendingOperationId,
                pendingLastKnown, blockedStep, blockedCode, blockedReason, c.environmentId(), c.runId(), orderUuid,
                expectedVersion);
    }
}
