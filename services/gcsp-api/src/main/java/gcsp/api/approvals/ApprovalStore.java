package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Explicit SQL reads of the approval tables (writes live in the commands) and their row shapes. */
final class ApprovalStore {

    static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    static final String HEAD_COLUMNS = "order_uuid, employee_id, entitlement_slot_id, renewal_id, route, source::text, "
            + "policy_version, stage_list::text, current_stage, outcome, stages::text, transition::text, "
            + "lifecycle_revision, version";
    static final String DECISION_COLUMNS = "operation_id, order_uuid, stage, intended_decision, ticks_required, "
            + "ticks_elapsed, phase, occurred_at, reason_code, reason, input_digest, provider_reference, outcome::text, "
            + "attempts, version, last_tick_id";

    private ApprovalStore() {}

    /** One order's head. Revision 0 (nothing stored, version 0) is derived from the source by initial(). */
    record Head(String orderUuid, String employeeId, String slotId, String renewalId, String route, JsonNode source,
            String policyVersion, List<String> stageList, String currentStage, String outcome, ArrayNode stages,
            JsonNode transition, long revision, long version) {

        /** The full lifecycle record (Node's revision record), as stored in approval_revisions. */
        ObjectNode record(RunContext ctx) {
            ObjectNode o = F.objectNode();
            o.put("schemaVersion", 1);
            o.put("lifecycleRevision", revision);
            o.put("runId", ctx.runId());
            o.put("orderUuid", orderUuid);
            o.put("employeeId", employeeId);
            o.put("entitlementSlotId", slotId);
            o.put("route", route);
            o.set("source", source);
            o.put("policyVersion", policyVersion);
            ArrayNode list = o.putArray("stageList");
            stageList.forEach(list::add);
            o.put("outcome", outcome);
            o.put("currentStage", currentStage);
            o.set("transition", transition == null ? F.nullNode() : transition);
            o.set("stages", stages);
            return o;
        }
    }

    record Decision(String operationId, String orderUuid, String stage, String intended, int ticksRequired,
            int ticksElapsed, String phase, Instant occurredAt, String reasonCode, String reason, String inputDigest,
            String providerReference, JsonNode outcome, int attempts, long version, String lastTickId) {

        boolean open() {
            return !"confirmed".equals(phase) && !"waiting".equals(phase);
        }
    }

    static String decisionId(String runId, String orderUuid, String stage) {
        ArrayNode key = F.arrayNode();
        key.add(runId).add(orderUuid).add(stage);
        return "approval:" + Canonical.digest(key);
    }

    static ObjectNode stageRow(String stage, String state, String at, String reference, String operationId) {
        ObjectNode o = F.objectNode();
        o.put("stage", stage);
        o.put("state", state);
        o.put("at", at);
        o.put("providerReference", reference);
        o.put("operationId", operationId);
        return o;
    }

    /** Revision 0: the acknowledged selection alone, with every later stage not started. Nothing is stored. */
    static Head initial(OrderSourcePort.SelectionOrder order, ApprovalPolicy.Policy p) {
        ArrayNode stages = F.arrayNode();
        for (int i = 0; i < p.stageList().size(); i++) {
            String stage = p.stageList().get(i);
            stages.add(i == 0
                    ? stageRow(stage, "approved", Time.format(order.receivedAt()), order.providerReference(), order.operationId())
                    : stageRow(stage, "not-started", null, null, null));
        }
        JsonNode source = order.source() == null ? F.objectNode() : order.source();
        return new Head(order.orderUuid(), order.employeeId(), order.entitlementSlotId(), order.renewalId(),
                order.route(), source, p.policyVersion(), p.stageList(), ApprovalPolicy.SELECTION_STAGE,
                "in-progress", stages, null, 0, 0);
    }

    static Map<String, Head> heads(Connection c, RunContext ctx, Collection<String> orderUuids) throws SQLException {
        Map<String, Head> out = new HashMap<>();
        if (orderUuids.isEmpty()) return out;
        String sql = "SELECT " + HEAD_COLUMNS + " FROM approval_orders WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ANY(?)";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setArray(3, c.createArrayOf("text", orderUuids.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Head h = head(rs);
                    out.put(h.orderUuid(), h);
                }
            }
        }
        return out;
    }

    static Optional<Head> head(Connection c, RunContext ctx, String orderUuid) throws SQLException {
        return Optional.ofNullable(heads(c, ctx, List.of(orderUuid)).get(orderUuid));
    }

    /** Decisions still waiting on the provider for the given orders, read through the open-decision partial index. */
    static Map<String, Decision> openDecisions(Connection c, RunContext ctx, Collection<String> orderUuids)
            throws SQLException {
        Map<String, Decision> out = new LinkedHashMap<>();
        if (orderUuids.isEmpty()) return out;
        String sql = "SELECT " + DECISION_COLUMNS + " FROM approval_decisions WHERE environment_id = ? AND run_id = ? "
                + "AND order_uuid = ANY(?) AND phase <> 'confirmed'";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setArray(3, c.createArrayOf("text", orderUuids.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Decision d = decision(rs);
                    out.put(d.orderUuid() + "\u0000" + d.stage(), d);
                }
            }
        }
        return out;
    }

    static Optional<Decision> decisionById(Connection c, RunContext ctx, String operationId) throws SQLException {
        return one(c, "operation_id = ?", ctx, operationId);
    }

    static Optional<Decision> decisionFor(Connection c, RunContext ctx, String orderUuid, String stage)
            throws SQLException {
        return one(c, "order_uuid = ? AND stage = ?", ctx, orderUuid, stage);
    }

    private static Optional<Decision> one(Connection c, String where, RunContext ctx, Object... keys)
            throws SQLException {
        String sql = "SELECT " + DECISION_COLUMNS + " FROM approval_decisions WHERE environment_id = ? AND run_id = ? AND "
                + where;
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            for (int i = 0; i < keys.length; i++) ps.setObject(i + 3, keys[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(decision(rs)) : Optional.empty();
            }
        }
    }

    /** Open decisions after the keyset cursor (order, stage), by the open-decision partial index. */
    static List<Decision> openAfter(Connection c, RunContext ctx, String afterOrder, String afterStage, int limit)
            throws SQLException {
        String sql = "SELECT " + DECISION_COLUMNS + " FROM approval_decisions WHERE environment_id = ? AND run_id = ? "
                + "AND phase <> 'confirmed' AND phase <> 'waiting' AND (order_uuid, stage) > (?, ?) "
                + "ORDER BY order_uuid, stage LIMIT ?";
        List<Decision> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, afterOrder);
            ps.setString(4, afterStage);
            ps.setInt(5, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(decision(rs));
            }
        }
        return out;
    }

    /** The latest completed approval tick's clock time, or null before any tick completed. */
    static Instant asOf(Connection c, RunContext ctx) throws SQLException {
        String sql = "SELECT now FROM approval_ticks WHERE environment_id = ? AND run_id = ? AND state = 'completed' "
                + "ORDER BY clock_version DESC LIMIT 1";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getObject(1, OffsetDateTime.class).toInstant() : null;
            }
        }
    }

    private static Head head(ResultSet rs) throws SQLException {
        List<String> stageList = new ArrayList<>();
        for (JsonNode n : json(rs.getString(8))) stageList.add(n.asText());
        JsonNode transition = rs.getString(12) == null ? null : json(rs.getString(12));
        return new Head(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                json(rs.getString(6)), rs.getString(7), stageList, rs.getString(9), rs.getString(10),
                (ArrayNode) json(rs.getString(11)), transition, rs.getLong(13), rs.getLong(14));
    }

    private static Decision decision(ResultSet rs) throws SQLException {
        OffsetDateTime at = rs.getObject(8, OffsetDateTime.class);
        String outcome = rs.getString(13);
        return new Decision(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5),
                rs.getInt(6), rs.getString(7), at == null ? null : at.toInstant(), rs.getString(9), rs.getString(10),
                rs.getString(11), rs.getString(12), outcome == null ? F.objectNode() : json(outcome), rs.getInt(14),
                rs.getLong(15), rs.getString(16));
    }

    static JsonNode json(String text) throws SQLException {
        try {
            return JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }
}
