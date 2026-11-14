package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** The explicit SQL of the appointment tables: keyed reads, a keyset page and the version-checked writes. */
final class AppointmentStore {

    private static final ObjectMapper JSON = new ObjectMapper();
    static final int PAGE = 100;
    private static final String COLUMNS = "order_uuid, employee_id, state, policy_version, provider_mode, opening::text, "
            + "confirmation::text, requested_slot::text, slot::text, proposed_slot::text, proposal_id, "
            + "accepted_proposal_id, pending_step, pending_operation_id, blocked::text, outcome::text, version";
    /** The tick's page over the partial index appointments_actionable (same predicate), after a cursor. */
    static final String ACTIONABLE_PAGE = "SELECT " + COLUMNS + " FROM appointments WHERE environment_id = ? AND run_id = ? "
            + "AND order_uuid > ? AND (state = 'requested' OR pending_step IS NOT NULL) ORDER BY order_uuid LIMIT " + PAGE;
    /** Startup reconcile only looks at appointments with an open provider write. */
    static final String PENDING_PAGE = "SELECT " + COLUMNS + " FROM appointments WHERE environment_id = ? AND run_id = ? "
            + "AND order_uuid > ? AND pending_step IS NOT NULL ORDER BY order_uuid LIMIT " + PAGE;

    private AppointmentStore() {}

    record Hist(String state, Instant at, String providerReference) {
        ObjectNode toJson() {
            return JSON.createObjectNode().put("state", state).put("at", Iso.format(at))
                    .put("providerReference", providerReference);
        }
    }

    /** One appointment row; history is loaded only where it is needed. */
    record Row(String orderUuid, String employeeId, String state, String policyVersion, String providerMode,
            JsonNode opening, JsonNode confirmation, Slot requestedSlot, Slot slot, Slot proposedSlot, String proposalId,
            String acceptedProposalId, String pendingStep, String pendingOperationId, JsonNode blocked, JsonNode outcome,
            long version, List<Hist> history) {

        Row withHistory(List<Hist> h) {
            return new Row(orderUuid, employeeId, state, policyVersion, providerMode, opening, confirmation, requestedSlot,
                    slot, proposedSlot, proposalId, acceptedProposalId, pendingStep, pendingOperationId, blocked, outcome,
                    version, List.copyOf(h));
        }
    }

    /** The mutable columns of an appointment while one settle or accept decides its next state. */
    static final class Edit {
        String state;
        Slot slot;
        Slot proposedSlot;
        String proposalId;
        String acceptedProposalId;
        String pendingStep;
        String pendingOperationId;
        JsonNode blocked;

        Edit(Row r) {
            state = r.state();
            slot = r.slot();
            proposedSlot = r.proposedSlot();
            proposalId = r.proposalId();
            acceptedProposalId = r.acceptedProposalId();
            pendingStep = r.pendingStep();
            pendingOperationId = r.pendingOperationId();
            blocked = r.blocked();
        }

        boolean differs(Row r) {
            return !(Objects.equals(state, r.state()) && Objects.equals(slot, r.slot())
                    && Objects.equals(proposedSlot, r.proposedSlot()) && Objects.equals(proposalId, r.proposalId())
                    && Objects.equals(acceptedProposalId, r.acceptedProposalId())
                    && Objects.equals(pendingStep, r.pendingStep())
                    && Objects.equals(pendingOperationId, r.pendingOperationId()) && Objects.equals(blocked, r.blocked()));
        }
    }

    /** One provider write: its fixed input (payload, digest) and the pending_operations facts. */
    record Op(String operationId, String step, String orderUuid, String state, long version, int attempts,
            JsonNode outcome, String inputDigest, JsonNode payload) {

        boolean open() {
            return "intent".equals(state) || "pending".equals(state);
        }

        Slot slot() {
            return Slot.fromJson(payload.get("slot"));
        }

        /** True once the provider said "not yet" (confirm before its delay): nothing was recorded there. */
        boolean inProgress() {
            return "in-progress".equals(outcome == null ? null : outcome.path("status").asText(null));
        }

        ProviderOperation toProvider(RunContext system) {
            return new ProviderOperation(system, operationId, AppointmentIds.operationType(step), orderUuid, step, slot(),
                    payload.deepCopy(), inputDigest);
        }
    }

    enum Probe { NONE, SAME, DIFFERENT }

    static Optional<Row> row(Connection c, RunContext run, String orderUuid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS + " FROM appointments WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ?")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(map(rs)) : Optional.empty();
            }
        }
    }

    static List<Hist> history(Connection c, RunContext run, String orderUuid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT state, at, provider_reference FROM appointment_history "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? ORDER BY seq")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            ps.setString(3, orderUuid);
            List<Hist> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Hist(rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant(), rs.getString(3)));
                }
            }
            return out;
        }
    }

    static List<Row> page(Connection c, RunContext run, String after, boolean pendingOnly) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(pendingOnly ? PENDING_PAGE : ACTIONABLE_PAGE)) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            ps.setString(3, after);
            List<Row> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(map(rs));
            }
            return out;
        }
    }

    static Optional<Op> op(Connection c, RunContext run, String operationId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT o.operation_id, i.step, i.order_uuid, o.state, o.version, "
                + "o.attempts, o.outcome::text, o.input_digest, i.payload::text FROM pending_operations o "
                + "JOIN appointment_operation_inputs i ON i.environment_id = o.environment_id AND i.run_id = o.run_id "
                + "AND i.operation_id = o.operation_id WHERE o.environment_id = ? AND o.run_id = ? AND o.operation_id = ?")) {
            ps.setString(1, run.environmentId());
            ps.setString(2, run.runId());
            ps.setString(3, operationId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(new Op(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5),
                        rs.getInt(6), json(rs.getString(7)), rs.getString(8), json(rs.getString(9))));
            }
        }
    }

    /** Whether this actor already has a receipt for the command id, and whether it holds the same input. */
    static Probe probe(Connection c, RunContext ctx, String commandId, String digest) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT input_digest FROM command_receipts WHERE environment_id = ? "
                + "AND run_id = ? AND actor_id = ? AND command_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, ctx.actorId());
            ps.setString(4, commandId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Probe.NONE;
                return digest.equals(rs.getString(1)) ? Probe.SAME : Probe.DIFFERENT;
            }
        }
    }

    static void insertAppointment(Tx tx, String orderUuid, String employeeId, String policyVersion, String providerMode,
            JsonNode opening, JsonNode confirmation, Slot requested, String operationId) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO appointments (environment_id, run_id, order_uuid, employee_id, state, policy_version, "
                + "provider_mode, opening, confirmation, requested_slot, pending_step, pending_operation_id) "
                + "VALUES (?, ?, ?, ?, 'not-requested', ?, ?, ?, ?, ?, 'request', ?)", c.environmentId(), c.runId(),
                orderUuid, employeeId, policyVersion, providerMode, opening, confirmation, requested.toJson(), operationId);
    }

    static void insertInput(Tx tx, String operationId, String step, String orderUuid, JsonNode payload)
            throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO appointment_operation_inputs (environment_id, run_id, operation_id, order_uuid, step, payload) "
                + "VALUES (?, ?, ?, ?, ?, ?)", c.environmentId(), c.runId(), operationId, orderUuid, step, payload);
    }

    /** Version-checked update of every column a settle or accept can move; the guard trigger needs version + 1. */
    static void save(Tx tx, Row row, Edit e) throws SQLException {
        RunContext c = tx.context();
        tx.cas("UPDATE appointments SET state = ?, slot = ?, proposed_slot = ?, proposal_id = ?, accepted_proposal_id = ?, "
                + "pending_step = ?, pending_operation_id = ?, blocked = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?", e.state,
                e.slot == null ? null : e.slot.toJson(), e.proposedSlot == null ? null : e.proposedSlot.toJson(),
                e.proposalId, e.acceptedProposalId, e.pendingStep, e.pendingOperationId, e.blocked, c.environmentId(),
                c.runId(), row.orderUuid(), row.version());
    }

    static void addHistory(Tx tx, String orderUuid, String state, Instant at, String providerReference)
            throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO appointment_history (environment_id, run_id, order_uuid, seq, state, at, provider_reference) "
                + "SELECT ?, ?, ?, coalesce(max(seq), 0) + 1, ?, ?, ? FROM appointment_history "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", c.environmentId(), c.runId(), orderUuid,
                state, at, providerReference, c.environmentId(), c.runId(), orderUuid);
    }

    private static Row map(ResultSet rs) throws SQLException {
        return new Row(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                json(rs.getString(6)), json(rs.getString(7)), Slot.fromJson(json(rs.getString(8))),
                Slot.fromJson(json(rs.getString(9))), Slot.fromJson(json(rs.getString(10))), rs.getString(11),
                rs.getString(12), rs.getString(13), rs.getString(14), json(rs.getString(15)), json(rs.getString(16)),
                rs.getLong(17), List.of());
    }

    static JsonNode json(String text) throws SQLException {
        if (text == null) return null;
        try {
            return JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored appointment JSON is unreadable");
        }
    }
}
