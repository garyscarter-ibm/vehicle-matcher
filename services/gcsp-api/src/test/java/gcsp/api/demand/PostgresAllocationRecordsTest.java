package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.demand.AllocationRecordsPort.RecordedDecision;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** The recorded allocation decisions over migrated tables seeded with the allocator's real column sets and JSON. */
class PostgresAllocationRecordsTest {

    private static final String E = DemandFixture.ENV;
    private static final String R = DemandFixture.RUN;

    private static String decision(String car, String gate, String versions) {
        return "{\"orderUuid\":\"" + car + "\",\"gateStatus\":\"" + gate + "\",\"score\":" + (gate.equals("eligible") ? "71.5" : "null")
                + ",\"reasons\":[{\"code\":\"fit\"}],\"blockers\":[],\"unknowns\":[{\"code\":\"charging\"}],\"versions\":" + versions + "}";
    }

    /** One allocation: its evaluations, contenders and (completed) assignments; evaluated_at is the day offset. */
    private static void run(DemandFixture f, String run, String id, int day, boolean completed, String evals, String contenders,
            String assignments) throws SQLException {
        f.update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, input_digest, "
                + "state, evaluated_at, clock_version, policy_version, plan, contender_count) VALUES (?, ?, ?, 'brief-changed', ?, ?, "
                + "'pending', ?::timestamptz, ?, ?, ?, 0)", E, run, id, "src-" + id + run, "1".repeat(64),
                "2026-11-" + (10 + day) + "T09:00:00Z", day, DemandFixture.POLICY,
                DemandFixture.json("{\"evaluatedAt\":\"2026-11-" + (10 + day) + "T09:00:00.000Z\",\"rule\":\"renewalDueThenFitThenSeededLottery\"}"));
        for (Object[] row : parse(contenders)) {
            f.update("INSERT INTO allocation_contenders (environment_id, run_id, allocation_id, ordinal, employee_id, slot_id, order_uuid, "
                    + "renewal_due, score, lottery, expected_versions, reasons, quote) VALUES (?, ?, ?, ?, ?, 'slot', ?, now(), 1, ?, ?, '[]', '{}')",
                    E, run, id, row[0], row[1], row[2], "f".repeat(64), DemandFixture.json((String) row[3]));
        }
        for (String[] ev : evaluations(evals)) {
            f.update("INSERT INTO allocation_evaluations (environment_id, run_id, allocation_id, employee_id, evaluation) VALUES (?, ?, ?, ?, ?)",
                    E, run, id, ev[0], DemandFixture.json(ev[1]));
        }
        if (completed) {
            f.update("UPDATE allocation_runs SET state = 'completed', outcome = ? WHERE environment_id = ? AND run_id = ? AND allocation_id = ?",
                    DemandFixture.json("{\"state\":\"allocated\",\"assignments\":" + assignments + "}"), E, run, id);
        }
    }

    // employee|body JSON pairs separated by ";;" and contenders as ordinal|employee|car|expectedVersions separated by ";;".
    private static List<String[]> evaluations(String text) {
        return text.isEmpty() ? List.of() : java.util.Arrays.stream(text.split(";;")).map(s -> s.split("\\|", 2)).toList();
    }

    private static List<Object[]> parse(String text) {
        return text.isEmpty() ? List.of() : java.util.Arrays.stream(text.split(";;")).map(s -> {
            String[] p = s.split("\\|", 4);
            return new Object[] {Integer.parseInt(p[0]), p[1], p[2], p[3]};
        }).toList();
    }

    private static String eval(String employee, String versions, String... decisions) {
        return employee + "|{\"employeeId\":\"" + employee + "\",\"versions\":" + versions + ",\"decisions\":[" + String.join(",", decisions) + "]}";
    }

    private static Map<String, RecordedDecision> read(DemandFixture f, DemandScope scope, List<String> employees, List<String> cars)
            throws Exception {
        try (Connection c = f.pool().getConnection()) {
            c.setAutoCommit(false);
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            List<RecordedDecision> rows = new PostgresAllocationRecords().read(c, scope, employees, cars).orElseThrow();
            c.rollback();
            return rows.stream().collect(Collectors.toMap(d -> d.employeeId() + "/" + d.orderUuid(), d -> d));
        }
    }

    private static final String RV = "{\"brief\":2,\"policy\":\"" + DemandFixture.POLICY + "\",\"facts\":\"employee:5:abc\"}";

    @Test
    void latestCompletedRunWinsAndPendingAndOtherRunsAreIgnored() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'run-2', 'retired', now())", E);
            run(f, R, "alloc-1", 1, true, eval("emp-1", RV, decision("car-a", "ineligible", "{\"brief\":1}")), "", "[]");
            run(f, R, "alloc-2", 2, true, eval("emp-1", RV, decision("car-a", "eligible", "{\"brief\":2}")), "", "[]");
            run(f, R, "alloc-3", 3, false, eval("emp-1", RV, decision("car-a", "needs-confirmation", "{\"brief\":3}")), "", "[]");
            run(f, "run-2", "alloc-9", 4, true, eval("emp-1", RV, decision("car-a", "needs-confirmation", "{\"brief\":9}")), "", "[]");
            run(f, R, "alloc-4", 5, true, eval("emp-1", RV, decision("car-z", "eligible", "{}")), "", "[]");
            Map<String, RecordedDecision> rows = read(f, DemandFixture.SCOPE, List.of("emp-1"), List.of("car-a"));
            assertEquals(1, rows.size());
            RecordedDecision d = rows.get("emp-1/car-a");
            assertEquals("eligible", d.gateStatus());
            assertEquals(71.5, d.score().asDouble());
            assertEquals(2L, d.briefVersion());
            assertEquals("2026-11-12T09:00:00.000Z", d.evaluatedAt());
            assertEquals("renewalDueThenFitThenSeededLottery", d.allocationRule());
            assertEquals("fit", d.reasons().get(0).get("code").asText());
            assertEquals("charging", d.unknowns().get(0).get("code").asText());
            assertTrue(read(f, DemandFixture.SCOPE, List.of("emp-9"), List.of("car-a")).isEmpty());
        }
    }

    @Test
    void assignmentsAndRecordedInputVersions() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            f.employee("emp-2");
            f.brief("emp-2", 2, DemandFixture.brief("estate", null, null, null),
                    DemandFixture.json("{\"searchConsent\":true,\"holdConsent\":true,\"paused\":false,\"permissionVersion\":3}"));
            String contenders = "0|emp-1|car-a|{\"employee\":7,\"permission\":4,\"brief\":2}";
            String assignments = "[{\"employeeId\":\"emp-1\",\"orderUuid\":\"car-a\"}]";
            String evals = eval("emp-1", "{\"brief\":2,\"policy\":\"p-old\"}", decision("car-a", "eligible", "{\"brief\":2,\"policy\":\"" + DemandFixture.POLICY + "\"}"),
                    decision("car-c", "eligible", "{}")) + ";;"
                    + eval("emp-2", RV, decision("car-a", "eligible", "{}"), decision("car-c", "ineligible", "{\"brief\":2}")) + ";;"
                    + eval("emp-3", "{\"policy\":\"p-old\"}", decision("car-c", "ineligible", "{}"));
            run(f, R, "alloc-1", 1, true, evals, contenders, assignments);
            Map<String, RecordedDecision> rows = read(f, DemandFixture.SCOPE, List.of("emp-1", "emp-2", "emp-3"), List.of("car-a", "car-c"));
            assertEquals(5, rows.size());

            RecordedDecision assigned = rows.get("emp-1/car-a");
            assertEquals("emp-1", assigned.assignedEmployeeId());
            assertEquals(7L, assigned.inputEmployeeVersion());
            assertEquals(4L, assigned.inputPermissionVersion());
            assertEquals(DemandFixture.POLICY, assigned.policyVersion());

            RecordedDecision otherCar = rows.get("emp-1/car-c");
            assertNull(otherCar.assignedEmployeeId());
            assertTrue(otherCar.employeeAssignedOtherCar());
            assertEquals("p-old", otherCar.policyVersion());
            assertEquals(2L, otherCar.briefVersion());

            RecordedDecision lost = rows.get("emp-2/car-a");
            assertEquals("emp-1", lost.assignedEmployeeId());
            assertFalse(lost.employeeAssignedOtherCar());
            assertEquals(5L, lost.inputEmployeeVersion());
            assertEquals(3L, lost.inputPermissionVersion());

            RecordedDecision none = rows.get("emp-2/car-c");
            assertNull(none.assignedEmployeeId());
            assertFalse(none.employeeAssignedOtherCar());

            RecordedDecision absent = rows.get("emp-3/car-c");
            assertNull(absent.briefVersion());
            assertNull(absent.inputEmployeeVersion());
            assertNull(absent.inputPermissionVersion());
            assertEquals("p-old", absent.policyVersion());
        }
    }

    @Test
    void malformedRowThrows() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            run(f, R, "alloc-1", 1, true, eval("emp-1", "{\"brief\":\"x\"}", decision("car-a", "eligible", "{\"brief\":\"x\"}")), "", "[]");
            assertThrows(SQLException.class, () -> read(f, DemandFixture.SCOPE, List.of("emp-1"), List.of("car-a")));
        }
    }
}
