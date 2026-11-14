package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.SQLException;

/** The allocation.complete command body: the final outcome from the stored plan and attempts, plus a counts-only event. */
final class Completion {

    private Completion() {}

    static WorkResult run(Tx tx, String allocationId) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        Object[] run = Sql.one(c, "SELECT version, state, next_index, contender_count, plan::text, evaluated_at "
                + "FROM allocation_runs WHERE environment_id = ? AND run_id = ? AND allocation_id = ? FOR UPDATE",
                rs -> new Object[] {rs.getLong(1), rs.getString(2), rs.getInt(3), rs.getInt(4), Sql.json(rs.getString(5))},
                x.environmentId(), x.runId(), allocationId);
        if (run == null) return WorkResult.refuse("allocation-not-found", "No such allocation.");
        if ("completed".equals(run[1])) return WorkResult.ok(Sql.JSON.createObjectNode().put("moved", true));
        if (!run[2].equals(run[3])) return WorkResult.refuse("allocation-incomplete", "Contenders remain to be claimed.");
        JsonNode plan = (JsonNode) run[4];

        ArrayNode assignments = Sql.JSON.createArrayNode();
        ArrayNode attempts = Sql.JSON.createArrayNode();
        for (ObjectNode[] row : Sql.query(c, "SELECT t.employee_id, t.slot_id, t.renewal_id, t.order_uuid, t.renewal_due, "
                + "t.score, t.lottery, t.expected_versions::text, t.reasons::text, t.quote::text, a.ordinal, "
                + "a.operation_id, a.status, a.code, a.hold_id, a.outcome::text FROM allocation_attempts a "
                + "JOIN allocation_contenders t ON t.environment_id = a.environment_id AND t.run_id = a.run_id "
                + "AND t.allocation_id = a.allocation_id AND t.ordinal = a.ordinal WHERE a.environment_id = ? "
                + "AND a.run_id = ? AND a.allocation_id = ? ORDER BY a.ordinal", rs -> {
                    ObjectNode attempt = Sql.JSON.createObjectNode();
                    attempt.put("ordinal", rs.getInt(11));
                    attempt.put("employeeId", rs.getString(1));
                    attempt.put("orderUuid", rs.getString(4));
                    attempt.put("operationId", rs.getString(12));
                    attempt.put("status", rs.getString(13));
                    attempt.put("code", rs.getString(14));
                    attempt.set("outcome", Sql.json(rs.getString(16)));
                    ObjectNode assignment = null;
                    if ("claimed".equals(rs.getString(13)) || "claim-pending".equals(rs.getString(13))) {
                        assignment = Sql.JSON.createObjectNode();
                        assignment.put("employeeId", rs.getString(1));
                        assignment.put("slotId", rs.getString(2));
                        assignment.put("renewalId", rs.getString(3));
                        assignment.put("orderUuid", rs.getString(4));
                        assignment.put("renewalDue", gcsp.api.policy.PolicyClock.iso(Sql.instant(rs, 5)));
                        double score = rs.getDouble(6);
                        if (rs.wasNull()) assignment.putNull("score"); else assignment.put("score", score);
                        assignment.put("lottery", rs.getString(7));
                        assignment.set("expectedVersions", Sql.json(rs.getString(8)));
                        assignment.set("reasons", Sql.json(rs.getString(9)));
                        assignment.put("holdId", rs.getString(15));
                        JsonNode claimed = Sql.json(rs.getString(16));
                        assignment.put("offerId", claimed.path("offerId").asText());
                        assignment.put("quoteId", claimed.path("quoteId").asText());
                        assignment.put("operationId", rs.getString(12));
                    }
                    return new ObjectNode[] {attempt, assignment};
                }, x.environmentId(), x.runId(), allocationId)) {
            attempts.add(row[0]);
            if (row[1] != null) assignments.add(row[1]);
        }
        long evaluated = plan.path("evaluatedEmployees").size();
        ObjectNode outcome = Sql.JSON.createObjectNode();
        outcome.put("state", assignments.isEmpty() ? "no-assignment" : "allocated");
        outcome.put("allocationId", allocationId);
        outcome.set("trigger", plan.get("trigger"));
        outcome.set("evaluatedAt", plan.get("evaluatedAt"));
        outcome.set("policyVersion", plan.get("policyVersion"));
        outcome.set("assumptions", plan.get("assumptions"));
        outcome.set("assignments", assignments);
        outcome.set("attempts", attempts);
        if (plan.has("excluded")) outcome.set("excluded", plan.get("excluded"));

        tx.cas("UPDATE allocation_runs SET state = 'completed', outcome = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND allocation_id = ? AND version = ? AND state = 'pending'",
                outcome, x.environmentId(), x.runId(), allocationId, run[0]);
        ObjectNode summary = Sql.JSON.createObjectNode();
        summary.put("allocationId", allocationId);
        summary.put("state", outcome.get("state").textValue());
        summary.put("triggerType", plan.path("trigger").path("type").asText());
        summary.put("evaluated", evaluated);
        summary.put("contenders", (Integer) run[3]);
        summary.put("attempts", attempts.size());
        summary.put("assignments", assignments.size());
        tx.emit("allocation-completed:" + allocationId, "allocation-completed", summary);
        return WorkResult.ok(summary);
    }
}
