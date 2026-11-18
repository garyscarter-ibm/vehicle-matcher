package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The latest recorded allocation decision of each (employee, car) pair, read in the snapshot connection by one
 * bounded statement (Node server/gcsp/presenter-suitability/http.js lines 46-95). A malformed row throws.
 */
@ApplicationScoped
public class PostgresAllocationRecords implements AllocationRecordsPort {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern FACTS = Pattern.compile("^employee:(\\d+):.*");

    /** Newest completed run first per pair, then the contender, assignment and brief lookups for those rows only. */
    static final String LATEST = "WITH d AS (SELECT DISTINCT ON (e.employee_id, x.value ->> 'orderUuid') "
            + "e.employee_id, x.value ->> 'orderUuid' AS order_uuid, x.value AS decision, e.evaluation -> 'versions' AS ev, "
            + "r.allocation_id, r.evaluated_at, r.policy_version, r.plan, r.outcome, "
            + "COALESCE(NULLIF(x.value #> '{versions,brief}', 'null'::jsonb), "
            + "NULLIF(e.evaluation #> '{versions,brief}', 'null'::jsonb)) AS brief "
            + "FROM allocation_runs r JOIN allocation_evaluations e ON e.environment_id = r.environment_id "
            + "AND e.run_id = r.run_id AND e.allocation_id = r.allocation_id "
            + "CROSS JOIN LATERAL jsonb_array_elements(e.evaluation -> 'decisions') x(value) "
            + "WHERE r.environment_id = ? AND r.run_id = ? AND r.state = 'completed' AND e.employee_id = ANY(?) "
            + "AND x.value ->> 'orderUuid' = ANY(?) "
            + "ORDER BY e.employee_id, x.value ->> 'orderUuid', r.evaluated_at DESC, r.clock_version DESC, r.allocation_id DESC) "
            + "SELECT d.employee_id, d.order_uuid, d.decision::text, d.ev::text, d.plan ->> 'evaluatedAt', "
            + "to_char(d.evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), d.policy_version, d.plan ->> 'rule', "
            + "d.brief::text, k.expected_versions::text, "
            + "(SELECT a ->> 'employeeId' FROM jsonb_array_elements(d.outcome -> 'assignments') a "
            + "WHERE a ->> 'orderUuid' = d.order_uuid LIMIT 1), "
            + "EXISTS (SELECT 1 FROM jsonb_array_elements(d.outcome -> 'assignments') a WHERE a ->> 'employeeId' = d.employee_id "
            + "AND a ->> 'orderUuid' <> d.order_uuid), "
            + "CASE WHEN jsonb_typeof(d.brief) = 'number' THEN (SELECT b.buddy -> 'permissionVersion' FROM briefs b "
            + "WHERE b.environment_id = ? AND b.run_id = ? AND b.employee_id = d.employee_id "
            + "AND b.brief_version = (d.brief #>> '{}')::bigint)::text END "
            + "FROM d LEFT JOIN LATERAL (SELECT c.expected_versions FROM allocation_contenders c WHERE c.environment_id = ? "
            + "AND c.run_id = ? AND c.allocation_id = d.allocation_id AND c.employee_id = d.employee_id "
            + "ORDER BY c.ordinal LIMIT 1) k ON true";

    @Override
    public Optional<List<RecordedDecision>> read(Connection snapshot, DemandScope scope, List<String> employeeIds,
            List<String> orderUuids) throws SQLException {
        List<RecordedDecision> out = new ArrayList<>();
        try (PreparedStatement ps = snapshot.prepareStatement(LATEST)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setArray(3, snapshot.createArrayOf("text", employeeIds.toArray()));
            ps.setArray(4, snapshot.createArrayOf("text", orderUuids.toArray()));
            ps.setString(5, scope.environmentId());
            ps.setString(6, scope.runId());
            ps.setString(7, scope.environmentId());
            ps.setString(8, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(row(rs));
            }
        }
        return Optional.of(List.copyOf(out));
    }

    private static RecordedDecision row(ResultSet rs) throws SQLException {
        String employee = rs.getString(1);
        JsonNode decision = json(rs.getString(3));
        if (!decision.isObject()) throw new SQLException("recorded decision is not an object");
        JsonNode runVersions = json(rs.getString(4));
        JsonNode own = decision.path("versions");
        String evaluatedAt = rs.getString(5) != null ? rs.getString(5) : rs.getString(6);
        Long brief = integer(rs.getString(9));
        JsonNode contender = json(rs.getString(10));
        JsonNode permission = contender.path("permission");
        Long inputPermission = permission.isNull() || permission.isMissingNode() ? integer(rs.getString(13)) : integer(permission.toString());
        Long inputEmployee = contender.path("employee").isNumber() ? integer(contender.get("employee").toString()) : employeeFromFacts(own, runVersions);
        String assigned = rs.getString(11);
        return new RecordedDecision(employee, rs.getString(2), text(decision.get("gateStatus")), decision.path("score"),
                decision.path("blockers"), decision.path("unknowns"), decision.path("reasons"), evaluatedAt, brief,
                firstText(own.get("policy"), runVersions.get("policy"), rs.getString(7)), rs.getString(8), inputPermission,
                inputEmployee, assigned, rs.getBoolean(12));
    }

    private static Long employeeFromFacts(JsonNode own, JsonNode runVersions) throws SQLException {
        JsonNode facts = own.hasNonNull("facts") ? own.get("facts") : runVersions.get("facts");
        Matcher m = facts != null && facts.isTextual() ? FACTS.matcher(facts.asText()) : null;
        return m != null && m.matches() ? integer(m.group(1)) : null;
    }

    private static String firstText(JsonNode a, JsonNode b, String c) {
        if (a != null && a.isTextual()) return a.asText();
        if (b != null && b.isTextual()) return b.asText();
        return c;
    }

    private static String text(JsonNode n) {
        return n != null && n.isTextual() ? n.asText() : null;
    }

    private static Long integer(String text) throws SQLException {
        if (text == null) return null;
        JsonNode n = json(text);
        if (n.isNull()) return null;
        if (!n.canConvertToLong() || n.isFloatingPointNumber()) throw new SQLException("recorded version is not an integer");
        return n.asLong();
    }

    private static JsonNode json(String text) throws SQLException {
        if (text == null) return JSON.nullNode();
        try {
            return JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException(e);
        }
    }
}
