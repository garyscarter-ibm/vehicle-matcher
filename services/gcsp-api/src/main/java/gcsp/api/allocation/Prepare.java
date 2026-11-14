package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** The allocation.prepare command body: freezes the ranked fallback list and each employee's explanation. */
final class Prepare {

    private static final int CAR_PAGE = 500;
    private static final int EMPLOYEE_PAGE = 200;
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    private record Engaged(String employeeId, long briefVersion, JsonNode content, JsonNode buddy, String digest) {}

    private record Owner(long employeeVersion, JsonNode employee, long slotVersion, JsonNode slot) {}

    private record Evaluation(String employeeId, String excludedCode, ObjectNode body) {}

    private final PolicyService policy;
    private final EligibleCandidates candidates;

    Prepare(PolicyService policy, EligibleCandidates candidates) {
        this.policy = policy;
        this.candidates = candidates;
    }

    WorkResult run(Tx tx, AllocationScope scope, Trigger trigger, String allocationId, String digest) throws Exception {
        Connection c = tx.connection();
        RunContext x = tx.context();
        String[] existing = Sql.one(c, "SELECT allocation_id, input_digest, state FROM allocation_runs "
                + "WHERE environment_id = ? AND run_id = ? AND source_event_id = ?",
                rs -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3)}, x.environmentId(), x.runId(),
                trigger.sourceEventId());
        if (existing != null) {
            if (!allocationId.equals(existing[0]) || !digest.equals(existing[1])) {
                return WorkResult.refuse("command-input-changed", "The trigger id was used with different input.");
            }
            return WorkResult.ok(Sql.JSON.createObjectNode().put("allocationId", allocationId).put("state", existing[2]));
        }
        Assumptions.Read read = Assumptions.read(policy, scope, trigger);
        if (read instanceof Assumptions.Failed f) return WorkResult.refuse(f.code(), f.message());
        Assumptions a = ((Assumptions.Ok) read).assumptions();

        Set<String> lapsed = lapsedHolders(c, x, trigger);
        List<EligibleCandidates.Car> pool = pool(c, x);
        List<Contender> contenders = new ArrayList<>();
        List<Evaluation> evaluations = new ArrayList<>();
        ArrayNode excluded = Sql.JSON.createArrayNode();
        String after = "";
        while (true) {
            List<Engaged> page = engagedPage(c, x, after);
            if (page.isEmpty()) break;
            for (Engaged e : page) {
                if (!Buddy.engaged(e.buddy())) continue;
                WorkResult failure = employee(c, x, scope, trigger, a, e, lapsed, pool, contenders, evaluations, excluded);
                if (failure != null) return failure;
            }
            after = page.get(page.size() - 1).employeeId();
        }
        contenders.sort(Contender.ranking(a.tieBreakRule()));
        write(tx, scope, trigger, allocationId, digest, a, pool.size(), contenders, evaluations, excluded);
        return WorkResult.ok(Sql.JSON.createObjectNode().put("allocationId", allocationId).put("state", "pending")
                .put("contenders", contenders.size()).put("evaluated", evaluations.size()));
    }

    private WorkResult employee(Connection c, RunContext x, AllocationScope scope, Trigger trigger, Assumptions a,
            Engaged e, Set<String> lapsed, List<EligibleCandidates.Car> pool, List<Contender> contenders,
            List<Evaluation> evaluations, ArrayNode excluded) throws SQLException {
        Owner owner = owner(c, x, e.employeeId());
        if (owner == null) return WorkResult.refuse("brief-owner-unavailable", "A Buddy brief has no employee or slot.");
        JsonNode attrs = owner.employee();
        String slotId = Buddy.text(attrs.get("entitlementSlotId"));
        String renewalId = firstText(e.content().get("renewalId"), owner.slot().get("renewalId"), attrs.get("renewalId"));
        Holds.Employee held = Holds.employee(c, x, e.employeeId(), slotId);
        if (lapsed.contains(e.employeeId()) || held.occupying() >= a.maxActive() || held.slotOccupying() > 0
                || held.slotAllocated() > 0 || Holds.renewalHeld(c, x, renewalId, false)) {
            return null;
        }
        JsonNode account = Sql.one(c, "SELECT record::text FROM employee_account_records WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", rs -> Sql.json(rs.getString(1)), x.environmentId(), x.runId(),
                e.employeeId());
        List<EligibleCandidates.Car> visible = new ArrayList<>();
        Map<String, EligibleCandidates.Car> byId = new HashMap<>();
        for (EligibleCandidates.Car car : pool) {
            if (visible(car.attributes(), attrs, e.employeeId())) {
                visible.add(car);
                byId.put(car.orderUuid(), car);
            }
        }
        EligibleCandidates.Result result;
        try {
            result = candidates.evaluate(new EligibleCandidates.Request(x.environmentId(), x.runId(),
                    scope.policyVersion(), scope.now(), scope.clockVersion(), new EligibleCandidates.Subject(
                            e.employeeId(), slotId, owner.employeeVersion(), attrs, account == null ? NullNode.instance : account,
                            e.briefVersion(), e.content()), visible));
        } catch (RuntimeException ex) {
            return WorkResult.refuse("candidates-unavailable", "The recommendation engine failed.");
        }
        if (!(result instanceof EligibleCandidates.Evaluated evaluated)) {
            return WorkResult.refuse("candidates-unavailable", "The recommendation engine is unavailable.");
        }
        Map<String, List<String>> declined = declined(c, x, e.employeeId());
        Set<String> letLapse = "buddy-expired".equals(trigger.type()) ? letLapse(c, x, e.employeeId()) : Set.of();
        Instant due = null;
        int currentContracts = 0;
        boolean dueKnown = false;
        boolean wasExcluded = false;
        ArrayNode decisions = Sql.JSON.createArrayNode();
        for (EligibleCandidates.Decision d : evaluated.decisions()) {
            EligibleCandidates.Car car = byId.get(d.orderUuid());
            if (car == null) continue;
            ArrayNode blockers = array(d.blockers());
            String gate = d.gateStatus();
            if (declined.getOrDefault(d.orderUuid(), List.of()).stream()
                    .anyMatch(old -> old == null || old.equals(e.digest()))) {
                gate = "ineligible";
                blockers.addObject().put("code", "declined-unchanged");
            }
            boolean contends = "eligible".equals(gate) && Buddy.flag(e.buddy(), "holdConsent")
                    && !letLapse.contains(d.orderUuid());
            if (contends) {
                if (!dueKnown) {
                    JsonNode[] current = currentContracts(account, e.employeeId(), attrs, slotId);
                    currentContracts = current.length;
                    due = current.length == 1 ? due(current[0]) : null;
                    dueKnown = true;
                }
                if (due == null) {
                    blockers.addObject().put("code", "renewal-deadline-unknown").put("currentContracts", currentContracts);
                    wasExcluded = true;
                    contends = false;
                }
            }
            if (contends) {
                if (d.quote() == null || !d.quote().isObject()) {
                    return WorkResult.refuse("candidates-unavailable", "An eligible decision has no quote.");
                }
                contenders.add(contender(scope, a, e, attrs, slotId, renewalId, owner, car, d, due));
            }
            ObjectNode row = decisions.addObject();
            row.put("orderUuid", d.orderUuid());
            row.put("gateStatus", gate);
            if (d.score() == null) row.putNull("score"); else row.put("score", d.score());
            row.set("reasons", nullSafe(d.reasons()));
            row.set("blockers", blockers);
            row.set("unknowns", nullSafe(d.unknowns()));
            row.set("versions", nullSafe(d.versions()));
        }
        if (wasExcluded) excluded.addObject().put("employeeId", e.employeeId()).put("code", "renewal-deadline-unknown");
        ObjectNode body = Sql.JSON.createObjectNode();
        body.put("employeeId", e.employeeId());
        body.set("versions", nullSafe(evaluated.versions()));
        body.set("decisions", decisions);
        evaluations.add(new Evaluation(e.employeeId(), wasExcluded ? "renewal-deadline-unknown" : null, body));
        return null;
    }

    private static Contender contender(AllocationScope scope, Assumptions a, Engaged e, JsonNode attrs, String slotId,
            String renewalId, Owner owner, EligibleCandidates.Car car, EligibleCandidates.Decision d, Instant due) {
        ObjectNode versions = Sql.JSON.createObjectNode();
        versions.put("stock", car.version());
        versions.put("slot", owner.slotVersion());
        versions.put("brief", e.briefVersion());
        versions.set("permission", e.buddy().path("permissionVersion").isMissingNode() ? NullNode.instance
                : e.buddy().get("permissionVersion"));
        versions.put("employee", owner.employeeVersion());
        versions.put("policy", scope.policyVersion());
        versions.put("clock", scope.clockVersion());
        ArrayNode reasons = Sql.JSON.createArrayNode();
        reasons.addObject().put("code", "allocation-policy").put("rule", a.tieBreakRule())
                .put("policyVersion", scope.policyVersion());
        reasons.addObject().put("code", "renewal-due").put("value", PolicyClock.iso(due));
        ObjectNode fit = reasons.addObject().put("code", "eligible-fit");
        if (d.score() == null) fit.putNull("score"); else fit.put("score", d.score());
        return new Contender(e.employeeId(), slotId, renewalId, d.orderUuid(), due, d.score(),
                Lottery.of(a.seed(), scope.runId(), e.employeeId(), d.orderUuid()), versions, reasons,
                (ObjectNode) d.quote());
    }

    private static Set<String> lapsedHolders(Connection c, RunContext x, Trigger trigger) throws SQLException {
        if (!trigger.returnsHolds()) return Set.of();
        return new HashSet<>(Sql.query(c, "SELECT DISTINCT employee_id FROM custody_holds WHERE environment_id = ? "
                + "AND run_id = ? AND hold_id = ANY(?)", rs -> rs.getString(1), x.environmentId(), x.runId(),
                trigger.holdIds().toArray(new String[0])));
    }

    /** Released cars nobody occupies or holds as allocated, in keyset pages of CAR_PAGE. */
    private static List<EligibleCandidates.Car> pool(Connection c, RunContext x) throws SQLException {
        String sql = "SELECT s.order_uuid, s.configuration_id, s.version, s.attributes::text FROM stock_cars s "
                + "WHERE s.environment_id = ? AND s.run_id = ? AND s.state = 'released' AND s.order_uuid > ? "
                + "AND NOT EXISTS (SELECT 1 FROM custody_holds h WHERE h.environment_id = s.environment_id "
                + "AND h.run_id = s.run_id AND h.order_uuid = s.order_uuid "
                + "AND (h.state IN " + Buddy.OCCUPYING + " OR h.state = 'allocated')) ORDER BY s.order_uuid LIMIT ?";
        List<EligibleCandidates.Car> pool = new ArrayList<>();
        String after = "";
        while (true) {
            List<EligibleCandidates.Car> page = Sql.query(c, sql, rs -> new EligibleCandidates.Car(rs.getString(1),
                    rs.getString(2), rs.getLong(3), Sql.json(rs.getString(4))), x.environmentId(), x.runId(), after,
                    CAR_PAGE);
            pool.addAll(page);
            if (page.size() < CAR_PAGE) return pool;
            after = page.get(page.size() - 1).orderUuid();
        }
    }

    private static List<Engaged> engagedPage(Connection c, RunContext x, String after) throws SQLException {
        String sql = "SELECT h.employee_id, h.brief_version, b.content::text, b.buddy::text, b.semantic_digest "
                + "FROM brief_heads h JOIN briefs b ON b.environment_id = h.environment_id AND b.run_id = h.run_id "
                + "AND b.employee_id = h.employee_id AND b.brief_version = h.brief_version "
                + "WHERE h.environment_id = ? AND h.run_id = ? AND h.brief_version > 0 AND h.employee_id > ? "
                + "AND b.buddy->'searchConsent' = 'true'::jsonb AND b.buddy->'holdConsent' = 'true'::jsonb "
                + "AND b.buddy->'paused' = 'false'::jsonb ORDER BY h.employee_id LIMIT ?";
        // The SQL narrows to the same flags Engagement.engaged checks; Buddy.engaged stays the final rule.
        return Sql.query(c, sql, rs -> new Engaged(rs.getString(1), rs.getLong(2), Sql.json(rs.getString(3)),
                Sql.json(rs.getString(4)), rs.getString(5)), x.environmentId(), x.runId(), after, EMPLOYEE_PAGE);
    }

    private static Owner owner(Connection c, RunContext x, String employeeId) throws SQLException {
        Object[] employee = Sql.one(c, "SELECT version, attributes::text FROM employees WHERE environment_id = ? "
                + "AND run_id = ? AND employee_id = ?", rs -> new Object[] {rs.getLong(1), Sql.json(rs.getString(2))},
                x.environmentId(), x.runId(), employeeId);
        if (employee == null) return null;
        String slotId = Buddy.text(((JsonNode) employee[1]).get("entitlementSlotId"));
        if (slotId == null) return null;
        Object[] slot = Sql.one(c, "SELECT version, attributes::text FROM entitlement_slots WHERE environment_id = ? "
                + "AND run_id = ? AND slot_id = ? AND employee_id = ?",
                rs -> new Object[] {rs.getLong(1), Sql.json(rs.getString(2))}, x.environmentId(), x.runId(), slotId,
                employeeId);
        if (slot == null) return null;
        return new Owner((Long) employee[0], (JsonNode) employee[1], (Long) slot[0], (JsonNode) slot[1]);
    }

    /** Offer order id to the semantic digests of the briefs it was declined under (null when that brief is missing). */
    private static Map<String, List<String>> declined(Connection c, RunContext x, String employeeId) throws SQLException {
        String sql = "SELECT o.order_uuid, (SELECT b.semantic_digest FROM briefs b WHERE b.environment_id = o.environment_id "
                + "AND b.run_id = o.run_id AND b.employee_id = o.employee_id AND b.brief_version = o.brief_version) "
                + "FROM buddy_offers o WHERE o.environment_id = ? AND o.run_id = ? AND o.employee_id = ? "
                + "AND o.state = 'declined'";
        Map<String, List<String>> out = new HashMap<>();
        for (String[] row : Sql.query(c, sql, rs -> new String[] {rs.getString(1), rs.getString(2)}, x.environmentId(),
                x.runId(), employeeId)) {
            out.computeIfAbsent(row[0], k -> new ArrayList<>()).add(row[1]);
        }
        return out;
    }

    private static Set<String> letLapse(Connection c, RunContext x, String employeeId) throws SQLException {
        return new HashSet<>(Sql.query(c, "SELECT order_uuid FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ? AND state = 'expired' AND attributes->>'releaseReason' = 'buddy-expired'",
                rs -> rs.getString(1), x.environmentId(), x.runId(), employeeId));
    }

    private static JsonNode[] currentContracts(JsonNode account, String employeeId, JsonNode attrs, String slotId) {
        List<JsonNode> found = new ArrayList<>();
        JsonNode contracts = account == null ? null : account.get("contracts");
        if (contracts != null && contracts.isArray()) {
            for (JsonNode k : contracts) {
                if ("current".equals(Buddy.text(k.get("status"))) && employeeId.equals(Buddy.text(k.get("employeeId")))
                        && java.util.Objects.equals(Buddy.text(attrs.get("schemeId")), Buddy.text(k.get("schemeId")))
                        && slotId.equals(Buddy.text(k.get("slotId")))) {
                    found.add(k);
                }
            }
        }
        return found.toArray(new JsonNode[0]);
    }

    private static Instant due(JsonNode contract) {
        String end = Buddy.text(contract.get("contractEndDate"));
        if (end == null || !DATE.matcher(end).matches()) return null;
        try {
            return LocalDate.parse(end).atStartOfDay(ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private static boolean visible(JsonNode car, JsonNode employee, String employeeId) {
        JsonNode v = car.get("visibility");
        if (v == null || !v.isObject() || !includes(v.get("companyIds"), Buddy.text(employee.get("companyId")))
                || !includes(v.get("schemeIds"), Buddy.text(employee.get("schemeId")))) {
            return false;
        }
        JsonNode only = v.get("employeeIds");
        return only == null || only.isNull() || includes(only, employeeId);
    }

    private static boolean includes(JsonNode array, String value) {
        if (array == null || !array.isArray() || value == null) return false;
        for (JsonNode n : array) if (n.isTextual() && n.textValue().equals(value)) return true;
        return false;
    }

    private static String firstText(JsonNode... nodes) {
        for (JsonNode n : nodes) {
            String t = Buddy.text(n);
            if (t != null) return t;
        }
        return null;
    }

    private static ArrayNode array(JsonNode n) {
        return n != null && n.isArray() ? ((ArrayNode) n).deepCopy() : Sql.JSON.createArrayNode();
    }

    private static JsonNode nullSafe(JsonNode n) {
        return n == null ? NullNode.instance : n;
    }

    private static void write(Tx tx, AllocationScope scope, Trigger trigger, String allocationId, String digest,
            Assumptions a, int poolSize, List<Contender> contenders, List<Evaluation> evaluations, ArrayNode excluded)
            throws SQLException {
        RunContext x = tx.context();
        ObjectNode plan = Sql.JSON.createObjectNode();
        plan.set("trigger", trigger.json());
        plan.put("evaluatedAt", PolicyClock.iso(scope.now()));
        plan.put("clockVersion", scope.clockVersion());
        plan.put("policyVersion", scope.policyVersion());
        plan.put("rule", a.tieBreakRule());
        plan.put("durationSeconds", a.durationSeconds());
        plan.put("maxActive", a.maxActive());
        plan.set("assumptions", a.recorded());
        plan.put("poolSize", poolSize);
        ArrayNode evaluated = plan.putArray("evaluatedEmployees");
        evaluations.forEach(ev -> evaluated.add(ev.employeeId()));
        if (!excluded.isEmpty()) plan.set("excluded", excluded);
        tx.write("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, "
                + "input_digest, state, evaluated_at, clock_version, policy_version, plan, contender_count, next_index) "
                + "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0)", x.environmentId(), x.runId(), allocationId,
                trigger.type(), trigger.sourceEventId(), digest, scope.now(), scope.clockVersion(),
                scope.policyVersion(), plan, contenders.size());
        Connection c = tx.connection();
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO allocation_contenders (environment_id, run_id, "
                + "allocation_id, ordinal, employee_id, slot_id, renewal_id, order_uuid, renewal_due, score, lottery, "
                + "expected_versions, reasons, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            for (int i = 0; i < contenders.size(); i++) {
                Contender k = contenders.get(i);
                Sql.bind(c, ps, new Object[] {x.environmentId(), x.runId(), allocationId, i, k.employeeId(), k.slotId(),
                    k.renewalId(), k.orderUuid(), k.renewalDue(), k.score(), k.lottery(), k.expectedVersions(),
                    k.reasons(), k.quote()});
                ps.addBatch();
            }
            if (!contenders.isEmpty()) ps.executeBatch();
        }
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO allocation_evaluations (environment_id, run_id, "
                + "allocation_id, employee_id, excluded_code, evaluation) VALUES (?, ?, ?, ?, ?, ?)")) {
            for (Evaluation ev : evaluations) {
                Sql.bind(c, ps, new Object[] {x.environmentId(), x.runId(), allocationId, ev.employeeId(),
                    ev.excludedCode(), ev.body()});
                ps.addBatch();
            }
            if (!evaluations.isEmpty()) ps.executeBatch();
        }
    }
}
