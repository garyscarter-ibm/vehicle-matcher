package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.notify.NotificationIntent;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.time.Instant;
import java.util.List;
import org.postgresql.util.PSQLException;

/** The allocation.claim body: lock, revalidate expected versions, then write the claim and advance the cursor. */
final class Claim {

    private record Run(long version, int nextIndex, int count, String state, Instant evaluatedAt, String policyVersion,
            long maxActive, long durationSeconds) {}

    private record Row(String employeeId, String slotId, String renewalId, String orderUuid, JsonNode versions,
            JsonNode quote) {}

    private record Car(String state, long version, String configurationId) {}

    private record Slot(long version, int capacity) {}

    /** The claim's outcome, or the refusal code that rolls the savepoint back. */
    private record Claimed(ObjectNode outcome, String refusal) {}

    private Claim() {}

    static WorkResult run(Tx tx, String allocationId, int ordinal, String operationId) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        Run run = Sql.one(c, "SELECT version, next_index, contender_count, state, evaluated_at, policy_version, "
                + "(plan->>'maxActive')::bigint, (plan->>'durationSeconds')::bigint FROM allocation_runs "
                + "WHERE environment_id = ? AND run_id = ? AND allocation_id = ? FOR UPDATE",
                rs -> new Run(rs.getLong(1), rs.getInt(2), rs.getInt(3), rs.getString(4), Sql.instant(rs, 5),
                        rs.getString(6), rs.getLong(7), rs.getLong(8)), x.environmentId(), x.runId(), allocationId);
        if (run == null) return WorkResult.refuse("allocation-not-found", "No such allocation.");
        // Another worker already moved this allocation on; nothing to write here.
        if ("completed".equals(run.state()) || run.nextIndex() != ordinal) {
            return WorkResult.ok(Sql.JSON.createObjectNode().put("moved", true));
        }
        Row k = Sql.one(c, "SELECT employee_id, slot_id, renewal_id, order_uuid, expected_versions::text, quote::text "
                + "FROM allocation_contenders WHERE environment_id = ? AND run_id = ? AND allocation_id = ? "
                + "AND ordinal = ?", rs -> new Row(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        Sql.json(rs.getString(5)), Sql.json(rs.getString(6))), x.environmentId(), x.runId(),
                allocationId, ordinal);
        if (k == null) return WorkResult.refuse("allocation-not-found", "No such contender.");

        if (alreadyTaken(c, x, allocationId, k)) return skip(tx, allocationId, run);
        String refusal = revalidate(c, x, run, k);
        if (refusal == null) {
            Savepoint sp = c.setSavepoint();
            try {
                Claimed claimed = claim(tx, allocationId, operationId, run, k);
                if (claimed.refusal() != null) {
                    c.rollback(sp);
                    refusal = claimed.refusal();
                } else {
                    c.releaseSavepoint(sp);
                    return advance(tx, allocationId, ordinal, operationId, run, "claimed", null, claimed.outcome());
                }
            } catch (SQLException e) {
                String code = conflictCode(e);
                if (code == null) throw e;
                c.rollback(sp);
                refusal = code;
            }
        }
        ObjectNode outcome = Sql.JSON.createObjectNode().put("status", "refused").put("code", refusal);
        return advance(tx, allocationId, ordinal, operationId, run, "refused", refusal, outcome);
    }

    /** An earlier claimed attempt in this allocation already took this employee, slot, renewal or car. */
    private static boolean alreadyTaken(Connection c, RunContext x, String allocationId, Row k) throws SQLException {
        String sql = "SELECT 1 FROM allocation_attempts a JOIN allocation_contenders t ON t.environment_id = a.environment_id "
                + "AND t.run_id = a.run_id AND t.allocation_id = a.allocation_id AND t.ordinal = a.ordinal "
                + "WHERE a.environment_id = ? AND a.run_id = ? AND a.allocation_id = ? AND a.status = 'claimed' "
                + "AND (t.employee_id = ? OR t.slot_id = ? OR t.order_uuid = ? OR (?::text IS NOT NULL AND t.renewal_id = ?)) "
                + "LIMIT 1";
        return Sql.one(c, sql, rs -> 1, x.environmentId(), x.runId(), allocationId, k.employeeId(), k.slotId(),
                k.orderUuid(), k.renewalId(), k.renewalId()) != null;
    }

    private static WorkResult skip(Tx tx, String allocationId, Run run) throws SQLException {
        advanceCursor(tx, allocationId, run);
        return WorkResult.ok(Sql.JSON.createObjectNode().put("status", "skipped"));
    }

    private static void advanceCursor(Tx tx, String allocationId, Run run) throws SQLException {
        RunContext x = tx.context();
        tx.cas("UPDATE allocation_runs SET next_index = next_index + 1, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND allocation_id = ? AND version = ? AND next_index = ?",
                x.environmentId(), x.runId(), allocationId, run.version(), run.nextIndex());
    }

    private static WorkResult advance(Tx tx, String allocationId, int ordinal, String operationId, Run run, String status,
            String code, ObjectNode outcome) throws SQLException {
        RunContext x = tx.context();
        tx.write("INSERT INTO allocation_attempts (environment_id, run_id, allocation_id, ordinal, operation_id, status, "
                + "code, hold_id, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", x.environmentId(), x.runId(),
                allocationId, ordinal, operationId, status, code,
                outcome.has("holdId") ? outcome.get("holdId").textValue() : null, outcome);
        advanceCursor(tx, allocationId, run);
        return WorkResult.ok(outcome.deepCopy().put("ordinal", ordinal));
    }

    /** The first expected-version or custody mismatch as a refusal code, or null when the claim may go ahead. */
    private static String revalidate(Connection c, RunContext x, Run run, Row k) throws SQLException {
        Car car = Sql.one(c, "SELECT state, version, configuration_id FROM stock_cars WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ?", rs -> new Car(rs.getString(1), rs.getLong(2), rs.getString(3)),
                x.environmentId(), x.runId(), k.orderUuid());
        if (car == null || car.version() != k.versions().path("stock").asLong(-1)) return "stale-version";
        if (!"released".equals(car.state()) || Holds.carHeld(c, x, k.orderUuid())) return "stock-unavailable";
        Slot slot = slot(c, x, k.slotId());
        if (slot == null || slot.version() != k.versions().path("slot").asLong(-1)) return "stale-version";
        Long employeeVersion = Sql.one(c, "SELECT version FROM employees WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", rs -> rs.getLong(1), x.environmentId(), x.runId(), k.employeeId());
        if (employeeVersion == null || employeeVersion != k.versions().path("employee").asLong(-1)) return "stale-version";
        Object[] head = Sql.one(c, "SELECT h.brief_version, b.buddy::text FROM brief_heads h JOIN briefs b "
                + "ON b.environment_id = h.environment_id AND b.run_id = h.run_id AND b.employee_id = h.employee_id "
                + "AND b.brief_version = h.brief_version WHERE h.environment_id = ? AND h.run_id = ? AND h.employee_id = ?",
                rs -> new Object[] {rs.getLong(1), Sql.json(rs.getString(2))}, x.environmentId(), x.runId(),
                k.employeeId());
        if (head == null || (Long) head[0] != k.versions().path("brief").asLong(-1)) return "stale-version";
        JsonNode buddy = (JsonNode) head[1];
        JsonNode permission = buddy.get("permissionVersion");
        if (!(permission == null ? NullNode.instance : permission).equals(k.versions().path("permission"))) {
            return "stale-version";
        }
        if (!Buddy.engaged(buddy)) return "buddy-not-permitted-to-hold";
        Holds.Employee held = Holds.employee(c, x, k.employeeId(), k.slotId());
        if (held.occupying() >= run.maxActive() || held.slotOccupying() > 0 || held.slotAllocated() > 0
                || Holds.renewalHeld(c, x, k.renewalId(), true)) {
            return "release-required";
        }
        return null;
    }

    private static Slot slot(Connection c, RunContext x, String slotId) throws SQLException {
        return Sql.one(c, "SELECT version, capacity FROM entitlement_slots WHERE environment_id = ? AND run_id = ? "
                + "AND slot_id = ?", rs -> new Slot(rs.getLong(1), rs.getInt(2)), x.environmentId(), x.runId(), slotId);
    }

    /** Writes the claim; a refusal code means nothing may be kept, so the caller rolls the savepoint back. */
    private static Claimed claim(Tx tx, String allocationId, String operationId, Run run, Row k) throws SQLException {
        Connection c = tx.connection();
        RunContext x = tx.context();
        String id = Canonical.digest(Sql.JSON.createArrayNode().add(x.runId()).add(operationId));
        String quoteId = "buddy-quote:" + id;
        String holdId = "buddy-hold:" + id;
        String offerId = "buddy-offer:" + id;
        Car car = Sql.one(c, "SELECT state, version, configuration_id FROM stock_cars WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ?", rs -> new Car(rs.getString(1), rs.getLong(2), rs.getString(3)),
                x.environmentId(), x.runId(), k.orderUuid());
        Slot slot = slot(c, x, k.slotId());
        List<Integer> taken = Holds.occupiedUnits(c, x, k.slotId());
        int unit = 1;
        while (taken.contains(unit)) unit++;
        if (slot == null || unit > slot.capacity()) return new Claimed(null, "slot-occupied");
        Instant expiresAt = run.evaluatedAt().plusSeconds(run.durationSeconds());

        ObjectNode quote = ((ObjectNode) k.quote()).deepCopy();
        quote.put("gateStatus", "eligible");
        quote.set("decision", decision(c, x, allocationId, k));
        JsonNode terms = quote.path("terms");
        JsonNode display = quote.path("snapshot").path("display");
        JsonNode points = terms.path("points");
        Integer monthly = points.isIntegralNumber() && points.canConvertToInt() && points.intValue() >= 0
                ? Integer.valueOf(points.intValue())
                : points.path("value").isIntegralNumber() && points.path("value").canConvertToInt()
                        && points.path("value").intValue() >= 0 ? Integer.valueOf(points.path("value").intValue()) : null;
        tx.write("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, "
                + "slot_id, configuration_id, policy_version, quoted_at, valid_until, monthly_points, vehicle_name, "
                + "image_path, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", x.environmentId(),
                x.runId(), quoteId, allocationId, k.orderUuid(), k.employeeId(), k.slotId(), car.configurationId(),
                run.policyVersion(), run.evaluatedAt(), instantOrNull(terms.get("validUntil")), monthly,
                vehicleName(display), Buddy.text(display.get("photo")), quote);

        ObjectNode attrs = Sql.JSON.createObjectNode();
        attrs.put("quoteId", quoteId).put("offerId", offerId).put("allocationId", allocationId);
        if (k.renewalId() == null) attrs.putNull("renewalId"); else attrs.put("renewalId", k.renewalId());
        attrs.put("policyVersion", run.policyVersion());
        tx.write("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, "
                + "slot_unit, hold_type, state, expires_at, operation_id, attributes) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 'buddy-offer', 'active', ?, ?, ?)", x.environmentId(), x.runId(), holdId,
                k.orderUuid(), k.employeeId(), k.slotId(), unit, expiresAt, operationId, attrs);
        int moved = tx.write("UPDATE stock_cars SET version = version + 1, updated_at = now() WHERE environment_id = ? "
                + "AND run_id = ? AND order_uuid = ? AND version = ?", x.environmentId(), x.runId(), k.orderUuid(),
                k.versions().path("stock").asLong());
        if (moved == 0) return new Claimed(null, "stale-version");
        tx.write("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, "
                + "state, brief_version, policy_version, expires_at, operation_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)", x.environmentId(), x.runId(), offerId, holdId,
                quoteId, k.employeeId(), k.orderUuid(), k.versions().path("brief").asLong(), run.policyVersion(),
                expiresAt, operationId);
        NotificationIntent.offer(tx, offerId, k.employeeId());
        ObjectNode out = Sql.JSON.createObjectNode().put("status", "claimed").put("holdId", holdId)
                .put("offerId", offerId).put("quoteId", quoteId).put("operationId", operationId)
                .put("slotUnit", unit).put("expiresAt", PolicyClock.iso(expiresAt));
        return new Claimed(out, null);
    }

    /** The prepare-time decision (gate, score, reasons, blockers, unknowns, versions) for this employee and car. */
    private static JsonNode decision(Connection c, RunContext x, String allocationId, Row k) throws SQLException {
        JsonNode found = Sql.one(c, "SELECT d::text FROM allocation_evaluations e, "
                + "jsonb_array_elements(e.evaluation->'decisions') d WHERE e.environment_id = ? AND e.run_id = ? "
                + "AND e.allocation_id = ? AND e.employee_id = ? AND d->>'orderUuid' = ?",
                rs -> Sql.json(rs.getString(1)), x.environmentId(), x.runId(), allocationId, k.employeeId(),
                k.orderUuid());
        if (found instanceof ObjectNode d) {
            d.remove("orderUuid");
            return d;
        }
        return Sql.JSON.createObjectNode();
    }

    private static Instant instantOrNull(JsonNode n) {
        String text = Buddy.text(n);
        if (text == null) return null;
        try {
            return java.time.OffsetDateTime.parse(text).toInstant();
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    private static String vehicleName(JsonNode display) {
        String name = Buddy.text(display.get("name"));
        if (name != null) return name;
        String model = Buddy.text(display.get("model"));
        String derivative = Buddy.text(display.get("derivative"));
        if (model == null) return null;
        return derivative == null ? model : model + " " + derivative;
    }

    /** The refusal code a unique violation maps to, or null when it is not a custody collision. */
    private static String conflictCode(SQLException e) {
        if (!"23505".equals(e.getSQLState())) return null;
        String constraint = e instanceof PSQLException p && p.getServerErrorMessage() != null
                ? p.getServerErrorMessage().getConstraint()
                : e.getCause() instanceof PSQLException cause && cause.getServerErrorMessage() != null
                        ? cause.getServerErrorMessage().getConstraint()
                        : null;
        if ("custody_holds_one_per_car".equals(constraint) || "buddy_offers_one_open_per_car".equals(constraint)) {
            return "car-held";
        }
        if ("custody_holds_one_per_slot_unit".equals(constraint)) return "slot-occupied";
        return null;
    }
}
