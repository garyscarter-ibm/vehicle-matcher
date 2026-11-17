package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * The demand snapshot over migrated tables, seeded by real INSERTs. Per run (seed): employees emp-1 (slot-1, ren-1, account record,
 * version 3) and emp-2 (no slot, no record, stored null gradeId); slots slot-1 and slot-2; briefs emp-1 v1 and v2, emp-2 v1;
 * cars car-a (released) and car-b (allocated); holds hold-1 (buddy, active, renewal) and hold-2 (cart, allocated);
 * one allocation with quotes q-1 and q-2; offers offer-1 (declined) and offer-2 (accepted); decisions dec-1 and dec-2.
 */
class PostgresDemandSnapshotTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String ENV = "demand-snapshot-env";
    private static final String RUN = PlanningFixtures.RUN;
    private static final String OTHER_RUN = "run-2";
    private static final String POLICY = PlanningFixtures.POLICY;
    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final List<String> TABLES = List.of("employees", "briefs", "entitlement_slots", "holds", "stock", "decisions",
            "offers");
    private static final List<String> BRIEF_TAIL = List.of("runId", "employeeId", "briefVersion", "previousBriefVersion", "status",
            "operation", "policyVersion", "confirmedBy", "confirmedAt", "entitlementSlotId");

    private String url;
    private String schema;
    private PGSimpleDataSource ds;

    @BeforeEach
    void migrate() throws Exception {
        url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        schema = "gcsp_ds_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        PGSimpleDataSource admin = new PGSimpleDataSource();
        admin.setUrl(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ds = new PGSimpleDataSource();
        ds.setUrl(url);
        ds.setCurrentSchema(schema);
        update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
    }

    @AfterEach
    void drop() throws SQLException {
        if (schema == null) {
            return;
        }
        PGSimpleDataSource admin = new PGSimpleDataSource();
        admin.setUrl(url);
        try (Connection c = admin.getConnection()) {
            c.createStatement().execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private void update(String sql, Object... args) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                Object a = args[i];
                if (a instanceof Instant t) {
                    ps.setTimestamp(i + 1, Timestamp.from(t));
                } else if (a instanceof JsonNode j) {
                    ps.setObject(i + 1, j.toString(), java.sql.Types.OTHER);
                } else {
                    ps.setObject(i + 1, a);
                }
            }
            ps.executeUpdate();
        }
    }

    private static JsonNode tree(String json) {
        try {
            return M.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private ObjectNode snapshot() throws SQLException {
        return PostgresDemandSnapshot.load(ds, new RunContext(ENV, RUN, "sub-greg"));
    }

    private static JsonNode byField(JsonNode array, String field, String value) {
        for (JsonNode n : array) {
            if (value.equals(n.path(field).textValue())) {
                return n;
            }
        }
        throw new AssertionError("No " + field + "=" + value + " in " + array);
    }

    private static List<String> names(JsonNode object) {
        List<String> out = new ArrayList<>();
        object.fieldNames().forEachRemaining(out::add);
        return out;
    }

    /** Rows are inserted in reverse key order so the ORDER BY clauses, not insertion order, produce the sorted arrays. */
    private void seed(String run, String company) throws SQLException {
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, 'emp-2', ?, 1)",
                ENV, run, tree("{\"companyId\":\"" + company + "\",\"gradeId\":null}"));
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, 'emp-1', ?, 3)", ENV,
                run, tree("{\"companyId\":\"" + company + "\",\"schemeId\":\"sch-1\",\"gradeId\":\"g-3\","
                        + "\"entitlementSlotId\":\"slot-1\",\"renewalId\":\"ren-1\",\"ignored\":\"x\"}"));
        update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record) "
                + "VALUES (?, ?, 'emp-1', 'rs-1', ?)", ENV, run, tree("{\"contract\":{\"endDate\":\"2027-02-04\"},\"points\":120}"));
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                + "VALUES (?, ?, 'slot-2', 'emp-2', 1, ?)", ENV, run, tree("{\"state\":null}"));
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                + "VALUES (?, ?, 'slot-1', 'emp-1', 2, ?)", ENV, run, tree("{\"renewalId\":\"ren-1\",\"state\":\"active\"}"));
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, 'emp-2', 1)", ENV, run);
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, 'emp-1', 2)", ENV, run);
        brief(run, "emp-1", 2, 1, "paused", "{\"preferences\":{\"colour\":\"blue\"},\"profile\":\"p1\"}", "2026-11-03T09:00:00Z");
        brief(run, "emp-1", 1, null, "confirmed", "{\"preferences\":{\"colour\":\"blue\"},\"profile\":\"p1\"}", "2026-11-02T09:00:00Z");
        brief(run, "emp-2", 1, null, "confirmed", "{\"preferences\":{}}", "2026-11-02T10:00:00Z");
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, 'car-b', 'cfg-2', 'allocated')", ENV, run);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, 'car-a', 'cfg-1', 'released')", ENV, run);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, 'hold-2', 'car-b', 'emp-1', 'slot-1', 2, 'cart', 'allocated', ?)", ENV, run,
                Instant.parse("2026-11-08T12:30:00Z"));
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at, attributes) VALUES (?, ?, 'hold-1', 'car-a', 'emp-1', 'slot-1', 1, 'buddy-offer', 'active', ?, ?)",
                ENV, run, Instant.parse("2026-11-07T00:00:00Z"), tree("{\"renewalId\":\"ren-1\"}"));
        update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, input_digest, "
                + "state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, 'alloc-1', 'brief-changed', 'src-1', ?, 'pending', ?, 1, ?, '{}', 0)", ENV, run, "5".repeat(64),
                Instant.parse("2026-11-04T00:00:00Z"), POLICY);
        quote(run, "q-1", "car-a", "cfg-1");
        quote(run, "q-2", "car-b", "cfg-2");
        offer(run, "offer-2", "hold-2", "q-2", "car-b", "accepted", 2);
        offer(run, "offer-1", "hold-1", "q-1", "car-a", "declined", 1);
        update("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, employee_id, "
                + "hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, 'offer-2', 'dec-2', 'cmd-2', ?, 'emp-1', 'hold-2', 'accept', NULL, NULL, ?, '{}', ?)", ENV, run,
                "6".repeat(64), tree("{\"brief\":5,\"briefVersion\":1}"), Instant.parse("2026-11-09T11:00:00Z"));
        update("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, command_id, input_digest, employee_id, "
                + "hold_id, decision, reason_code, reason, versions, outcome, decided_at) "
                + "VALUES (?, ?, 'offer-1', 'dec-1', 'cmd-1', ?, 'emp-1', 'hold-1', 'decline', 'not-now', NULL, ?, '{}', ?)", ENV, run,
                "7".repeat(64), tree("{\"briefVersion\":2,\"policyVersion\":\"" + POLICY + "\"}"),
                Instant.parse("2026-11-09T10:15:30.123Z"));
    }

    private void brief(String run, String employee, long version, Integer previous, String operation, String content, String at)
            throws SQLException {
        update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, content, "
                + "buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)", ENV, run, employee, version, previous, operation, tree(content),
                "a".repeat(64), POLICY, "sub-" + employee, Instant.parse(at), "cmd-" + employee + "-" + version);
    }

    private void quote(String run, String quoteId, String car, String configuration) throws SQLException {
        update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, slot_id, "
                + "configuration_id, policy_version, quoted_at, quote) VALUES (?, ?, ?, 'alloc-1', ?, 'emp-1', 'slot-1', ?, ?, ?, '{}')",
                ENV, run, quoteId, car, configuration, POLICY, Instant.parse("2026-11-04T00:00:00Z"));
    }

    private void offer(String run, String offerId, String hold, String quoteId, String car, String state, long briefVersion)
            throws SQLException {
        update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, state, "
                + "brief_version, policy_version, expires_at) VALUES (?, ?, ?, ?, ?, 'emp-1', ?, ?, ?, ?, ?)", ENV, run, offerId, hold,
                quoteId, car, state, briefVersion, POLICY, Instant.parse("2026-11-07T00:00:00Z"));
    }

    @Test
    void anInactiveOrUnknownRunReturnsNull() throws Exception {
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())", ENV, OTHER_RUN);
        seed(RUN, "co-1");

        assertNull(PostgresDemandSnapshot.load(ds, new RunContext(ENV, OTHER_RUN, "sub-greg")));
        assertNull(PostgresDemandSnapshot.load(ds, new RunContext(ENV, "run-9", "sub-greg")));
        assertNull(PostgresDemandSnapshot.load(ds, new RunContext("other-env", RUN, "sub-greg")));
        assertNotNull(snapshot());
    }

    @Test
    void aFullySeededRunReturnsEveryTableInNodeShapeAndSorted() throws Exception {
        seed(RUN, "co-1");

        ObjectNode out = snapshot();

        assertEquals(TABLES, names(out));
        assertEquals(tree("""
                {"employees":[
                  {"runId":"run-1","employeeId":"emp-1","version":3,"companyId":"co-1","schemeId":"sch-1","gradeId":"g-3",
                   "entitlementSlotId":"slot-1","renewalId":"ren-1",
                   "contract":{"manualContext":{"contract":{"endDate":"2027-02-04"},"points":120}}},
                  {"runId":"run-1","employeeId":"emp-2","version":1,"companyId":"co-1","gradeId":null}],
                 "briefs":[
                  {"preferences":{"colour":"blue"},"profile":"p1","runId":"run-1","employeeId":"emp-1","briefVersion":1,
                   "previousBriefVersion":null,"status":"confirmed","operation":"confirmed","policyVersion":"gcsp-policy-v1",
                   "confirmedBy":"sub-emp-1","confirmedAt":"2026-11-02T09:00:00.000Z","entitlementSlotId":"slot-1"},
                  {"preferences":{"colour":"blue"},"profile":"p1","runId":"run-1","employeeId":"emp-1","briefVersion":2,
                   "previousBriefVersion":1,"status":"confirmed","operation":"paused","policyVersion":"gcsp-policy-v1",
                   "confirmedBy":"sub-emp-1","confirmedAt":"2026-11-03T09:00:00.000Z","entitlementSlotId":"slot-1"},
                  {"preferences":{},"runId":"run-1","employeeId":"emp-2","briefVersion":1,"previousBriefVersion":null,
                   "status":"confirmed","operation":"confirmed","policyVersion":"gcsp-policy-v1","confirmedBy":"sub-emp-2",
                   "confirmedAt":"2026-11-02T10:00:00.000Z"}],
                 "entitlement_slots":[
                  {"entitlementSlotId":"slot-1","employeeId":"emp-1","capacity":2,"version":1,"renewalId":"ren-1","state":"active"},
                  {"entitlementSlotId":"slot-2","employeeId":"emp-2","capacity":1,"version":1,"state":null}],
                 "holds":[
                  {"holdId":"hold-1","orderUuid":"car-a","employeeId":"emp-1","entitlementSlotId":"slot-1","type":"buddy-offer",
                   "state":"active","expiresAt":"2026-11-07T00:00:00.000Z","version":1,"renewalId":"ren-1"},
                  {"holdId":"hold-2","orderUuid":"car-b","employeeId":"emp-1","entitlementSlotId":"slot-1","type":"cart",
                   "state":"allocated","expiresAt":"2026-11-08T12:30:00.000Z","version":1,"renewalId":"ren-1"}],
                 "stock":[
                  {"orderUuid":"car-a","configurationId":"cfg-1","state":"released","version":1},
                  {"orderUuid":"car-b","configurationId":"cfg-2","state":"allocated","version":1}],
                 "decisions":[
                  {"decisionId":"dec-1","offerId":"offer-1","holdId":"hold-1","employeeId":"emp-1","decision":"decline",
                   "reasonCode":"not-now","versions":{"briefVersion":2,"policyVersion":"gcsp-policy-v1","brief":2},
                   "decidedAt":"2026-11-09T10:15:30.123Z"},
                  {"decisionId":"dec-2","offerId":"offer-2","holdId":"hold-2","employeeId":"emp-1","decision":"accept",
                   "reasonCode":null,"versions":{"brief":5,"briefVersion":1},"decidedAt":"2026-11-09T11:00:00.000Z"}],
                 "offers":[
                  {"offerId":"offer-1","holdId":"hold-1","employeeId":"emp-1","orderUuid":"car-a","state":"declined",
                   "briefVersion":1,"policyVersion":"gcsp-policy-v1","version":1},
                  {"offerId":"offer-2","holdId":"hold-2","employeeId":"emp-1","orderUuid":"car-b","state":"accepted",
                   "briefVersion":2,"policyVersion":"gcsp-policy-v1","version":1}]}
                """), tree(out.toString()));
        assertEquals(List.of("runId", "employeeId", "version", "companyId", "schemeId", "gradeId", "entitlementSlotId", "renewalId",
                "contract"), names(out.get("employees").get(0)));
    }

    @Test
    void absentOptionalAttributesStayAbsentAndAStoredJsonNullStaysNull() throws Exception {
        seed(RUN, "co-1");

        ObjectNode out = snapshot();

        JsonNode emp2 = byField(out.get("employees"), "employeeId", "emp-2");
        assertTrue(emp2.has("gradeId") && emp2.get("gradeId").isNull());
        for (String absent : List.of("schemeId", "entitlementSlotId", "renewalId")) {
            assertFalse(emp2.has(absent), absent);
        }
        JsonNode slot2 = byField(out.get("entitlement_slots"), "entitlementSlotId", "slot-2");
        assertTrue(slot2.has("state") && slot2.get("state").isNull());
        assertFalse(slot2.has("renewalId"));
        assertFalse(byField(out.get("employees"), "employeeId", "emp-1").has("ignored"));
    }

    @Test
    void anEmployeeWithoutAnAccountRecordHasNoContractKey() throws Exception {
        seed(RUN, "co-1");

        ObjectNode out = snapshot();

        assertFalse(byField(out.get("employees"), "employeeId", "emp-2").has("contract"));
        assertEquals(tree("{\"contract\":{\"endDate\":\"2027-02-04\"},\"points\":120}"),
                byField(out.get("employees"), "employeeId", "emp-1").get("contract").get("manualContext"));
    }

    @Test
    void aBriefRowMergesContentAndKeysAndGetsTheEmployeesSlot() throws Exception {
        seed(RUN, "co-1");
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, 'emp-3', ?)", ENV, RUN,
                tree("{\"entitlementSlotId\":7}"));
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, 'emp-3', 1)", ENV, RUN);
        brief(RUN, "emp-3", 1, null, "confirmed", "{\"preferences\":{}}", "2026-11-02T11:00:00Z");

        ObjectNode out = snapshot();

        JsonNode v2 = out.get("briefs").get(1);
        List<String> names = names(v2);
        assertEquals(BRIEF_TAIL, names.subList(names.size() - BRIEF_TAIL.size(), names.size()));
        assertEquals(List.of("preferences", "profile"), names.subList(0, names.size() - BRIEF_TAIL.size()).stream().sorted().toList());
        assertEquals(2L, v2.get("briefVersion").longValue());
        assertEquals(1L, v2.get("previousBriefVersion").longValue());
        assertEquals("slot-1", v2.get("entitlementSlotId").textValue());
        assertTrue(out.get("briefs").get(0).get("previousBriefVersion").isNull());
        assertFalse(v2.has("renewalId"));
        // No slot in the employee's attributes, or a non-text one, leaves the brief without entitlementSlotId (D1).
        assertFalse(byField(out.get("briefs"), "employeeId", "emp-2").has("entitlementSlotId"));
        assertFalse(byField(out.get("briefs"), "employeeId", "emp-3").has("entitlementSlotId"));
    }

    @Test
    void aDecisionGetsVersionsBriefFromVersionsBriefVersion() throws Exception {
        seed(RUN, "co-1");

        JsonNode versions = byField(snapshot().get("decisions"), "decisionId", "dec-1").get("versions");

        assertEquals(2, versions.get("brief").intValue());
        assertEquals(2, versions.get("briefVersion").intValue());
        assertEquals(POLICY, versions.get("policyVersion").textValue());
    }

    @Test
    void anExistingVersionsBriefIsKeptAndANullReasonCodeStaysNull() throws Exception {
        seed(RUN, "co-1");

        JsonNode accept = byField(snapshot().get("decisions"), "decisionId", "dec-2");

        assertEquals(5, accept.get("versions").get("brief").intValue());
        assertEquals(1, accept.get("versions").get("briefVersion").intValue());
        assertTrue(accept.has("reasonCode") && accept.get("reasonCode").isNull());
    }

    @Test
    void holdStockAndOfferFieldsMapWithExpiryAsIso() throws Exception {
        seed(RUN, "co-1");

        ObjectNode out = snapshot();

        JsonNode hold = byField(out.get("holds"), "holdId", "hold-1");
        assertEquals("2026-11-07T00:00:00.000Z", hold.get("expiresAt").textValue());
        assertEquals("slot-1", hold.get("entitlementSlotId").textValue());
        assertEquals("buddy-offer", hold.get("type").textValue());
        assertEquals("ren-1", hold.get("renewalId").textValue());
        assertEquals("allocated", byField(out.get("stock"), "orderUuid", "car-b").get("state").textValue());
        JsonNode offer = byField(out.get("offers"), "offerId", "offer-2");
        assertEquals(2L, offer.get("briefVersion").longValue());
        assertEquals("hold-2", offer.get("holdId").textValue());
        assertEquals("accepted", offer.get("state").textValue());
        assertEquals(POLICY, offer.get("policyVersion").textValue());
        assertEquals(3L, byField(out.get("employees"), "employeeId", "emp-1").get("version").longValue());
    }

    @Test
    void twoLoadsOfTheSameStateAreEqual() throws Exception {
        seed(RUN, "co-1");

        assertEquals(snapshot(), snapshot());
    }

    @Test
    void aCartHoldTakesItsSlotsRenewalSoAManualSelectionIsAlreadySelected() throws Exception {
        seed(RUN, "co-1");
        // emp-1 needs a confirmed renewal for the cohort to reach the already-selected check.
        update("UPDATE employee_account_records SET record = ? WHERE environment_id = ? AND run_id = ? AND employee_id = 'emp-1'",
                tree("{\"contracts\":[{\"status\":\"current\",\"contractEndDate\":\"2027-02-04\"}]}"), ENV, RUN);
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, 'emp-4', ?)", ENV, RUN,
                tree("{\"entitlementSlotId\":\"slot-4\"}"));
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                + "VALUES (?, ?, 'slot-4', 'emp-4', 1, '{}')", ENV, RUN);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, 'car-d', 'cfg-1', 'allocated')", ENV, RUN);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at, attributes) VALUES (?, ?, 'hold-4', 'car-d', 'emp-4', 'slot-4', 1, 'cart', 'allocated', ?, ?)",
                ENV, RUN, Instant.parse("2026-11-08T12:30:00Z"), tree("{\"renewalId\":null}"));
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, 'hold-5', 'car-a', 'emp-4', 'slot-4', 1, 'cart', 'expired', ?)", ENV, RUN,
                Instant.parse("2026-11-08T12:30:00Z"));

        ObjectNode out = snapshot();

        // A cart hold with no stored renewal takes its slot's; a stored JSON null stays null; no slot renewal gives null.
        assertEquals("ren-1", byField(out.get("holds"), "holdId", "hold-2").get("renewalId").textValue());
        assertTrue(byField(out.get("holds"), "holdId", "hold-4").get("renewalId").isNull());
        assertTrue(byField(out.get("holds"), "holdId", "hold-5").get("renewalId").isNull());
        List<DemandCohort.Step> steps = DemandCohort.steps(out, "2027-12-31T23:59:59.999Z");
        assertEquals(new DemandCohort.Excluded("emp-1", "already-selected"), steps.get(0));
    }

    @Test
    void anotherRunsRowsAreExcluded() throws Exception {
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())", ENV, OTHER_RUN);
        seed(RUN, "co-1");
        seed(OTHER_RUN, "co-other");

        ObjectNode out = snapshot();

        assertFalse(out.toString().contains("co-other"));
        assertFalse(out.toString().contains(OTHER_RUN));
        assertEquals(2, out.get("employees").size());
        assertEquals(3, out.get("briefs").size());
        assertEquals(2, out.get("entitlement_slots").size());
        assertEquals(2, out.get("holds").size());
        assertEquals(2, out.get("stock").size());
        assertEquals(2, out.get("decisions").size());
        assertEquals(2, out.get("offers").size());
    }
}
