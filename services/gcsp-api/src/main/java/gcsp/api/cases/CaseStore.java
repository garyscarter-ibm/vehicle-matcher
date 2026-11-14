package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Tx;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Explicit SQL for the case tables. Reads take any connection; writes go through the command's Tx. */
final class CaseStore {

    record History(Instant at, String actorId, String actorRole, String status, String reason, ObjectNode trigger,
            String nextAction, Instant dueAt, ObjectNode remedy) {}

    record Row(String caseId, String employeeId, String renewalId, String status, String ownerRole, String ownerName,
            String reason, ObjectNode trigger, String nextAction, Instant dueAt, Instant openedAt, Instant lastUpdatedAt,
            LocalDate renewalDeadline, String renewalDeadlineState, String policyVersion, ObjectNode remedy, long version,
            List<History> history) {}

    private static final String COLUMNS = "case_id, employee_id, renewal_id, status, owner_role, owner_name, reason, "
            + "trigger::text, next_action, due_at, opened_at, last_updated_at, renewal_deadline, renewal_deadline_state, "
            + "policy_version, remedy::text, version";
    private static final String ACTIVE = "status IN ('open', 'in-progress', 'remedy-proposed')";

    private CaseStore() {}

    /** Every case of the run, of one employee, or one case, with its history: a cases query and one history query. */
    static List<Row> read(Connection c, String env, String run, String employeeId, String caseId) throws SQLException {
        String filter = (employeeId == null ? "" : " AND employee_id = ?") + (caseId == null ? "" : " AND case_id = ?");
        String joined = (employeeId == null ? "" : " AND c.employee_id = ?") + (caseId == null ? "" : " AND c.case_id = ?");
        Map<String, List<History>> histories = new LinkedHashMap<>();
        List<Row> bare = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT " + COLUMNS + " FROM renewal_cases WHERE environment_id = ? "
                + "AND run_id = ?" + filter + " ORDER BY opened_at, case_id")) {
            bind(ps, env, run, employeeId, caseId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) bare.add(row(rs));
            }
        }
        try (PreparedStatement ps = c.prepareStatement("SELECT h.case_id, h.at, h.actor_id, h.actor_role, h.status, h.reason, "
                + "h.trigger::text, h.next_action, h.due_at, h.remedy::text FROM renewal_case_history h "
                + "JOIN renewal_cases c ON c.environment_id = h.environment_id AND c.run_id = h.run_id AND c.case_id = h.case_id "
                + "WHERE c.environment_id = ? AND c.run_id = ?" + joined + " ORDER BY h.case_id, h.seq")) {
            bind(ps, env, run, employeeId, caseId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    histories.computeIfAbsent(rs.getString(1), k -> new ArrayList<>()).add(new History(instant(rs, 2),
                            rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), object(rs.getString(7)),
                            rs.getString(8), instant(rs, 9), object(rs.getString(10))));
                }
            }
        }
        List<Row> out = new ArrayList<>();
        for (Row r : bare) {
            out.add(new Row(r.caseId(), r.employeeId(), r.renewalId(), r.status(), r.ownerRole(), r.ownerName(), r.reason(),
                    r.trigger(), r.nextAction(), r.dueAt(), r.openedAt(), r.lastUpdatedAt(), r.renewalDeadline(),
                    r.renewalDeadlineState(), r.policyVersion(), r.remedy(), r.version(),
                    histories.getOrDefault(r.caseId(), List.of())));
        }
        return out;
    }

    static Optional<Row> one(Connection c, String env, String run, String caseId) throws SQLException {
        return read(c, env, run, null, caseId).stream().findFirst();
    }

    /** Locks the employee's active case for this renewal, if any. */
    static Optional<Row> lockActive(Tx tx, String employeeId, String renewalId) throws SQLException {
        return tx.first("SELECT " + COLUMNS + " FROM renewal_cases WHERE environment_id = ? AND run_id = ? AND employee_id = ? "
                + "AND renewal_id = ? AND " + ACTIVE + " FOR UPDATE", rs -> row(rs), tx.context().environmentId(),
                tx.context().runId(), employeeId, renewalId);
    }

    static Optional<Row> lock(Tx tx, String caseId) throws SQLException {
        return tx.first("SELECT " + COLUMNS + " FROM renewal_cases WHERE environment_id = ? AND run_id = ? AND case_id = ? "
                + "FOR UPDATE", rs -> row(rs), tx.context().environmentId(), tx.context().runId(), caseId);
    }

    /** Inserts the case unless another active case already holds the employee's renewal; true when inserted. */
    static boolean insert(Tx tx, Row r) throws SQLException {
        return tx.write("INSERT INTO renewal_cases (environment_id, run_id, case_id, employee_id, renewal_id, status, owner_role, "
                + "owner_name, reason, trigger, next_action, due_at, opened_at, last_updated_at, renewal_deadline, "
                + "renewal_deadline_state, policy_version, remedy, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                + "?, ?, ?::jsonb, ?) ON CONFLICT DO NOTHING", tx.context().environmentId(), tx.context().runId(), r.caseId(),
                r.employeeId(), r.renewalId(), r.status(), r.ownerRole(), r.ownerName(), r.reason(), r.trigger(), r.nextAction(),
                r.dueAt(), r.openedAt(), r.lastUpdatedAt(), r.renewalDeadline(), r.renewalDeadlineState(), r.policyVersion(),
                r.remedy() == null ? null : r.remedy().toString(), r.version()) > 0;
    }

    /** Appends the next history entry; the caller holds the case row lock, so max(seq) + 1 cannot race. */
    static void appendHistory(Tx tx, String caseId, History h) throws SQLException {
        String env = tx.context().environmentId();
        String run = tx.context().runId();
        tx.write("INSERT INTO renewal_case_history (environment_id, run_id, case_id, seq, at, actor_id, actor_role, status, "
                + "reason, trigger, next_action, due_at, remedy) VALUES (?, ?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM "
                + "renewal_case_history WHERE environment_id = ? AND run_id = ? AND case_id = ?), ?, ?, ?, ?, ?, ?::jsonb, ?, ?, "
                + "?::jsonb)", env, run, caseId, env, run, caseId, h.at(), h.actorId(), h.actorRole(), h.status(), h.reason(),
                h.trigger() == null ? null : h.trigger().toString(), h.nextAction(), h.dueAt(),
                h.remedy() == null ? null : h.remedy().toString());
    }

    /** The one version check of a write; a lost race is stale-version. */
    static void casUpdate(Tx tx, String caseId, long version, String status, String nextAction, Instant dueAt, ObjectNode remedy,
            Instant now) throws SQLException {
        tx.cas("UPDATE renewal_cases SET status = ?, next_action = ?, due_at = ?, remedy = ?::jsonb, last_updated_at = ?, "
                + "version = version + 1 WHERE environment_id = ? AND run_id = ? AND case_id = ? AND version = ?", status,
                nextAction, dueAt, remedy == null ? null : remedy.toString(), now, tx.context().environmentId(),
                tx.context().runId(), caseId, version);
    }

    static void casTouch(Tx tx, String caseId, long version, Instant now) throws SQLException {
        tx.cas("UPDATE renewal_cases SET last_updated_at = ?, version = version + 1 WHERE environment_id = ? AND run_id = ? "
                + "AND case_id = ? AND version = ?", now, tx.context().environmentId(), tx.context().runId(), caseId, version);
    }

    private static void bind(PreparedStatement ps, String env, String run, String employeeId, String caseId) throws SQLException {
        int i = 1;
        ps.setString(i++, env);
        ps.setString(i++, run);
        if (employeeId != null) ps.setString(i++, employeeId);
        if (caseId != null) ps.setString(i, caseId);
    }

    private static Row row(ResultSet rs) throws SQLException {
        return new Row(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getString(7), object(rs.getString(8)), rs.getString(9), instant(rs, 10), instant(rs, 11), instant(rs, 12),
                rs.getObject(13, LocalDate.class), rs.getString(14), rs.getString(15), object(rs.getString(16)), rs.getLong(17),
                List.of());
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static ObjectNode object(String json) throws SQLException {
        if (json == null) return null;
        try {
            JsonNode n = CaseJson.M.readTree(json);
            if (n instanceof ObjectNode o) return o;
        } catch (java.io.IOException e) {
            throw new SQLException("Stored case JSON is unreadable");
        }
        throw new SQLException("Stored case JSON is not an object");
    }
}
