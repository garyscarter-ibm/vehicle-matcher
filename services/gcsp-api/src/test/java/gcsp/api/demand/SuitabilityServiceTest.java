package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.AllocationRecordsPort.RecordedDecision;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class SuitabilityServiceTest {

    private static final String ENGAGED = "{\"searchConsent\":true,\"holdConsent\":true,\"paused\":false,\"permissionVersion\":3}";
    private static final String RULE = "renewalDueThenFitThenSeededLottery";

    private static ObjectNode engaged() {
        return DemandFixture.json(ENGAGED);
    }

    private static void buddy(DemandFixture f, String id, int version) throws Exception {
        f.employee(id);
        f.brief(id, version, DemandFixture.brief("estate", null, null, null), engaged());
    }

    private static String car(String name, String model, String colour, String number) {
        return "{\"orderNumber\":\"" + number + "\",\"facts\":{\"display\":{\"name\":" + (name == null ? "null" : "\"" + name + "\"")
                + "},\"facts\":{" + (model == null ? "" : "\"modelLine\":{\"status\":\"known\",\"value\":\"" + model + "\"}")
                + (model != null && colour != null ? "," : "")
                + (colour == null ? "" : "\"colour\":{\"status\":\"known\",\"value\":\"" + colour + "\"}") + "}},"
                + "\"release\":{\"availability\":{\"state\":\"available\"}}}";
    }

    private static ObjectNode j(String text) {
        return DemandFixture.json(text);
    }

    private static JsonNode num(String literal) {
        return j("{\"v\":" + literal + "}").get("v");
    }

    private static RecordedDecision decision(String employee, String car, String gate, JsonNode score) {
        return new RecordedDecision(employee, car, gate, score, DemandFixture.M.createArrayNode(), DemandFixture.M.createArrayNode(),
                DemandFixture.M.createArrayNode(), "2026-11-13T09:00:00.000Z", 1L, DemandFixture.POLICY, RULE, 3L, 1L, null, false);
    }

    private static RecordedDecision versions(RecordedDecision d, Long permission, Long employee) {
        return new RecordedDecision(d.employeeId(), d.orderUuid(), d.gateStatus(), d.score(), d.blockers(), d.unknowns(), d.reasons(),
                d.evaluatedAt(), d.briefVersion(), d.policyVersion(), d.allocationRule(), permission, employee, null, false);
    }

    private static ObjectNode value(DemandResult r) {
        if (r instanceof DemandResult.Ok ok) return ok.value();
        throw new AssertionError("expected ok but was " + r);
    }

    private static ObjectNode ok(DemandFixture f, int page, int buddyPage, String release) throws Exception {
        return value(f.suitability().read(DemandFixture.SCOPE, page, buddyPage, release));
    }

    private static ObjectNode ok(DemandFixture f) throws Exception {
        return ok(f, 1, 1, "all");
    }

    private static DemandResult.Refusal refusal(DemandResult r) {
        return (DemandResult.Refusal) r;
    }

    private static String unavailable(DemandResult r) {
        DemandResult.Refusal f = refusal(r);
        assertEquals(503, f.http());
        assertTrue(f.retryable());
        assertEquals("Car suitability could not be read. Try again.", f.reason());
        return f.code();
    }

    private static JsonNode cell(ObjectNode v, int car, int buddy) {
        return v.get("cars").get(car).get("cells").get(buddy);
    }

    private static List<String> ids(ObjectNode v) {
        List<String> out = new ArrayList<>();
        v.get("cars").forEach(c -> out.add(c.get("id").asText()));
        return out;
    }

    private static SuitabilityService with(DemandFixture f, DemandPolicyPort policy, AllocationRecordsPort records) throws Exception {
        return new SuitabilityService(f.pool(), policy, records, Clock.fixed(DemandFixture.NOW, ZoneOffset.UTC));
    }

    /** One buddy, one released car: the shape most scenarios start from. */
    private static DemandFixture one() throws Exception {
        DemandFixture f = DemandFixture.create();
        buddy(f, "emp-a", 1);
        f.stock("car-1", "released", car(null, "X1", "Red", "ON-1"));
        f.release("t1", "2026-11-13T08:00:00Z", "car-1");
        return f;
    }

    @Test
    void recordedDecisionsDriveCellsNeverTheHighestFit() throws Exception {
        try (DemandFixture f = one()) {
            f.stock("car-2", "released", car(null, "X3", null, "ON-2"));
            f.release("t2", "2026-11-13T08:30:00Z", "car-2");
            f.records.decisions.add(decision("emp-a", "car-1", "eligible", num("10")));
            ObjectNode v = ok(f);
            assertEquals(List.of("car-2", "car-1"), ids(v));
            assertEquals("not-evaluated", cell(v, 0, 0).get("state").asText());
            JsonNode c = cell(v, 1, 0);
            assertEquals("evaluated", c.get("state").asText());
            assertEquals(10, c.get("score").asInt());
            assertEquals("not-assigned", c.get("outcome").get("state").asText());
            assertTrue(f.records.sawSnapshot);
            assertEquals(List.of("emp-a"), f.records.lastEmployees);
            assertEquals(List.of("car-2", "car-1"), f.records.lastCars);
        }
    }

    @Test
    void theLatestConfirmedBriefControlsEngagedMembership() throws Exception {
        try (DemandFixture f = one()) {
            f.employee("emp-b");
            f.brief("emp-b", 1, DemandFixture.brief("estate", null, null, null), engaged());
            f.brief("emp-b", 2, DemandFixture.brief("estate", null, null, null),
                    j("{\"searchConsent\":true,\"holdConsent\":true,\"paused\":true}"));
            f.employee("emp-c");
            f.brief("emp-c", 1, DemandFixture.brief("estate", null, null, null),
                    j("{\"searchConsent\":true,\"holdConsent\":false,\"paused\":false}"));
            f.employee("emp-d");
            f.brief("emp-d", 1, DemandFixture.brief("estate", null, null, null), j("{\"searchConsent\":true,\"holdConsent\":true}"));
            f.employee("emp-e");
            f.draft("emp-e", 1, DemandFixture.brief("estate", null, null, null));
            ObjectNode v = ok(f);
            assertEquals(1, v.get("buddies").size());
            assertEquals("emp-a", v.get("buddies").get(0).get("id").asText());
            assertEquals(1, v.get("paging").get("buddies").get("total").asInt());
        }
    }

    @Test
    void aBriefWithoutAnEmployeeRowIsNotABuddy() throws Exception {
        try (DemandFixture f = one()) {
            f.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, 'ghost', 1)",
                    DemandFixture.ENV, DemandFixture.RUN);
            f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, operation, content, buddy, semantic_digest, "
                    + "policy_version, confirmed_by, confirmed_at, command_id) VALUES (?, ?, 'ghost', 1, 'confirmed', '{}'::jsonb, ?, ?, ?, 'p', "
                    + "now(), 'cmd-ghost')", DemandFixture.ENV, DemandFixture.RUN, engaged(), "a".repeat(64), DemandFixture.POLICY);
            assertEquals(1, ok(f).get("buddies").size());
        }
    }

    @Test
    void allAndLatestReleasesGiveDistinctExactCars() throws Exception {
        try (DemandFixture f = one()) {
            f.stock("car-2", "released", car(null, "X3", null, "ON-2"));
            f.stock("car-3", "released", car(null, "X5", null, "ON-3"));
            f.release("t2", "2026-11-13T09:00:00Z", "car-2", "car-1");
            f.release("t3", "2026-11-13T09:30:00Z", "car-3");
            ObjectNode all = ok(f);
            assertEquals(List.of("car-3", "car-2", "car-1"), ids(all));
            assertEquals(3, all.get("paging").get("cars").get("total").asInt());
            assertEquals("all", all.get("release").asText());
            ObjectNode latest = ok(f, 1, 1, "latest");
            assertEquals(List.of("car-3"), ids(latest));
            assertEquals("latest", latest.get("release").asText());
        }
    }

    @Test
    void bothPageAxesPageAndClamp() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            for (int i = 1; i <= 6; i++) buddy(f, "emp-" + i, 1);
            String[] cars = new String[10];
            for (int i = 0; i < 10; i++) {
                cars[i] = String.format("car-%02d", i);
                f.stock(cars[i], "released", car(null, "X1", null, "ON-" + i));
            }
            f.release("t1", "2026-11-13T08:00:00Z", cars);
            ObjectNode first = ok(f);
            assertEquals(8, first.get("cars").size());
            assertEquals(4, first.get("buddies").size());
            assertEquals(4, first.get("cars").get(0).get("cells").size());
            ObjectNode second = ok(f, 2, 2, "all");
            assertEquals(2, second.get("cars").size());
            assertEquals(2, second.get("buddies").size());
            assertEquals(2, second.get("cars").get(0).get("cells").size());
            ObjectNode clamped = ok(f, 99, 99, "all");
            JsonNode cars2 = clamped.get("paging").get("cars");
            assertEquals(2, cars2.get("page").asInt());
            assertEquals(2, cars2.get("pages").asInt());
            assertEquals(10, cars2.get("total").asInt());
            assertEquals(8, cars2.get("size").asInt());
            JsonNode buddies2 = clamped.get("paging").get("buddies");
            assertEquals(2, buddies2.get("pages").asInt());
            assertEquals(4, buddies2.get("size").asInt());
            assertEquals(6, buddies2.get("total").asInt());
            assertEquals(second.get("cars"), clamped.get("cars"));
            assertEquals(second.get("buddies"), clamped.get("buddies"));
        }
    }

    @Test
    void anEmptyRunStillHasOnePageAndNeverCallsThePort() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            ObjectNode v = ok(f);
            assertEquals(1, v.get("paging").get("cars").get("pages").asInt());
            assertEquals(0, v.get("paging").get("cars").get("total").asInt());
            assertEquals(1, v.get("paging").get("buddies").get("page").asInt());
            assertEquals(0, v.get("cars").size());
            assertEquals(0, f.records.calls.get());
        }
    }

    @Test
    void legacyScoresAreKeptOrNullAndNestedFactsAreRedacted() throws Exception {
        try (DemandFixture f = one()) {
            f.records.decisions.add(decision("emp-a", "car-1", "ineligible", num("0")));
            JsonNode c = cell(ok(f), 0, 0);
            assertTrue(c.get("score").isNumber());
            assertEquals(0, c.get("score").asInt());
            for (JsonNode bad : new JsonNode[] {num("101"), num("-1"), num("\"7\""), null, DemandFixture.M.nullNode()}) {
                f.records.decisions.clear();
                f.records.decisions.add(decision("emp-a", "car-1", "ineligible", bad));
                assertTrue(cell(ok(f), 0, 0).get("score").isNull(), String.valueOf(bad));
            }
            JsonNode raw = j("{\"code\":\"seats\",\"field\":\"seats\",\"observed\":2,\"desired\":5,\"secret\":\"x\","
                    + "\"facts\":{\"vin\":\"V\"},\"observed2\":{\"a\":1},\"requirement\":{\"operator\":\"gte\",\"value\":[\"a\",\"b\"],"
                    + "\"unit\":\"count\",\"extra\":1}}");
            JsonNode partial = j("{\"code\":\"fuel\",\"requirement\":{\"value\":[1,2]},\"actual\":{\"deep\":true},"
                    + "\"availableFrom\":\"2026-12-01\",\"requiredBy\":false}");
            var arr = DemandFixture.M.createArrayNode().add(raw).add(partial).add(j("{\"field\":\"x\"}")).add("junk");
            f.records.decisions.clear();
            f.records.decisions.add(new RecordedDecision("emp-a", "car-1", "needs-confirmation", num("55.5"), arr, arr, arr,
                    "2026-11-13T09:00:00.000Z", 1L, DemandFixture.POLICY, null, 3L, 1L, null, false));
            JsonNode d = cell(ok(f), 0, 0);
            assertEquals(2, d.get("blockers").size());
            assertEquals(j("{\"code\":\"seats\",\"field\":\"seats\",\"desired\":5,\"observed\":2,"
                    + "\"requirement\":{\"operator\":\"gte\",\"value\":[\"a\",\"b\"],\"unit\":\"count\"}}"), d.get("blockers").get(0));
            assertEquals(j("{\"code\":\"fuel\",\"availableFrom\":\"2026-12-01\",\"requiredBy\":false,\"requirement\":{}}"),
                    d.get("blockers").get(1));
            assertEquals(d.get("blockers"), d.get("unknowns"));
            assertEquals(d.get("blockers"), d.get("reasons"));
            assertFalse(d.toString().contains("vin"));
            assertFalse(d.toString().contains("secret"));
            assertTrue(d.get("recorded").get("allocationRule").isNull());
            assertEquals(55.5, d.get("score").asDouble());
        }
    }

    @Test
    void staleVersionsShowOutdatedAndANewBriefOutdatesTheResult() throws Exception {
        try (DemandFixture f = one()) {
            f.records.decisions.add(decision("emp-a", "car-1", "eligible", num("80")));
            assertFalse(cell(ok(f), 0, 0).get("outdated").asBoolean());
            f.brief("emp-a", 2, DemandFixture.brief("estate", null, null, null), engaged());
            assertTrue(cell(ok(f), 0, 0).get("outdated").asBoolean());
            assertEquals(2, ok(f).get("buddies").get(0).get("briefVersion").asInt());
        }
        try (DemandFixture f = one()) {
            f.records.decisions.add(versions(decision("emp-a", "car-1", "eligible", num("80")), 2L, 1L));
            assertTrue(cell(ok(f), 0, 0).get("outdated").asBoolean(), "permission version");
            f.records.decisions.clear();
            f.records.decisions.add(versions(decision("emp-a", "car-1", "eligible", num("80")), 3L, 2L));
            assertTrue(cell(ok(f), 0, 0).get("outdated").asBoolean(), "employee version");
            f.setEmployee("emp-a", "{\"name\":\"A\"}", 2);
            assertFalse(cell(ok(f), 0, 0).get("outdated").asBoolean());
        }
    }

    @Test
    void aChangedScopePolicyMarksResultsOutdatedAndTheRuleComesFromPolicy() throws Exception {
        try (DemandFixture f = one()) {
            f.records.decisions.add(decision("emp-a", "car-1", "eligible", num("80")));
            ObjectNode v = ok(f);
            assertEquals(RULE, v.get("policy").get("allocationRule").asText());
            assertTrue(v.get("policy").get("minimumFit").isNull());
            assertEquals(DemandFixture.POLICY, v.get("policy").get("version").asText());
            assertEquals(RULE, cell(v, 0, 0).get("recorded").get("allocationRule").asText());
            assertFalse(cell(v, 0, 0).get("outdated").asBoolean());
            f.policy.version = "gcsp-policy-v2";
            DemandScope next = new DemandScope(DemandFixture.ENV, DemandFixture.RUN, "gcsp-policy-v2");
            ObjectNode changed = value(f.suitability().read(next, 1, 1, "all"));
            assertTrue(cell(changed, 0, 0).get("outdated").asBoolean());
            assertEquals("gcsp-policy-v2", changed.get("policy").get("version").asText());
            assertEquals(RULE, changed.get("policy").get("allocationRule").asText());
        }
    }

    @Test
    void unknownOrMissingPolicyRuleIsNullNotAFailure() throws Exception {
        try (DemandFixture f = one()) {
            f.policy.absent = true;
            assertTrue(ok(f).get("policy").get("allocationRule").isNull());
            f.policy.absent = false;
            f.policy.version = "other";
            assertTrue(ok(f).get("policy").get("allocationRule").isNull());
            DemandPolicyPort odd = (version, asOf) -> Optional.of(new DemandPolicyPort.DemandPolicy(version, null, null, null, null, null,
                    DemandFixture.M.getNodeFactory().textNode("someOtherRule")));
            assertTrue(value(with(f, odd, f.records).read(DemandFixture.SCOPE, 1, 1, "all")).get("policy").get("allocationRule").isNull());
            DemandPolicyPort fit = (version, asOf) -> Optional.of(new DemandPolicyPort.DemandPolicy(version, null, null, null, null, null,
                    DemandFixture.M.getNodeFactory().textNode("fitThenRenewalDueThenSeededLottery")));
            assertEquals("fitThenRenewalDueThenSeededLottery",
                    value(with(f, fit, f.records).read(DemandFixture.SCOPE, 1, 1, "all")).get("policy").get("allocationRule").asText());
            DemandPolicyPort throwing = (version, asOf) -> {
                throw new IllegalStateException("down");
            };
            assertEquals("suitability-unavailable", unavailable(with(f, throwing, f.records).read(DemandFixture.SCOPE, 1, 1, "all")));
        }
    }

    @Test
    void occupancyIsIndependentOfEvaluationAndReleasedOrExpiredHoldsAreIgnored() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            buddy(f, "emp-a", 1);
            f.employee("holder");
            f.setEmployee("holder", "{\"firstName\":\" Ada \",\"lastName\":\"Lovelace\"}", 1);
            f.employee("owner");
            f.setEmployee("owner", "{}", 1);
            String[] ids = {"c-avail", "c-held", "c-buddy", "c-alloc", "c-rel", "c-exp", "c-off", "c-pend"};
            for (String id : ids) f.stock(id, "released", car(null, "X1", null, id));
            f.update("UPDATE stock_cars SET attributes = '{\"release\":{\"availability\":{\"state\":\"unavailable\"}}}'::jsonb "
                    + "WHERE order_uuid = 'c-off'");
            f.release("t1", "2026-11-13T08:00:00Z", ids);
            f.hold("h1", "c-held", "holder", "cart", "active");
            f.hold("h2", "c-buddy", "holder", "buddy-offer", "selection-pending");
            f.hold("h3", "c-alloc", "owner", "cart", "allocated");
            f.hold("h4", "c-rel", "holder", "cart", "released");
            f.hold("h5", "c-exp", "holder", "cart", "expired");
            f.hold("h6", "c-pend", "holder", "cart", "claim-pending");
            ObjectNode v = ok(f);
            assertEquals(8, v.get("cars").size());
            Map<String, JsonNode> by = new HashMap<>();
            v.get("cars").forEach(c -> by.put(c.get("id").asText(), c.get("availability")));
            assertEquals("available", by.get("c-avail").get("state").asText());
            assertEquals("unavailable", by.get("c-off").get("state").asText());
            assertEquals("available", by.get("c-rel").get("state").asText());
            assertEquals("available", by.get("c-exp").get("state").asText());
            assertEquals("reserved", by.get("c-held").get("state").asText());
            assertEquals("Ada Lovelace", by.get("c-held").get("employeeName").asText());
            assertEquals("holder", by.get("c-held").get("employeeId").asText());
            assertEquals("manual", by.get("c-held").get("route").asText());
            assertEquals("buddy", by.get("c-buddy").get("route").asText());
            assertEquals("allocated", by.get("c-alloc").get("state").asText());
            assertEquals("owner", by.get("c-alloc").get("employeeName").asText());
            assertEquals("reserved", by.get("c-pend").get("state").asText());
            v.get("cars").forEach(c -> assertEquals("not-evaluated", c.get("cells").get(0).get("state").asText()));
            assertEquals(1, f.records.calls.get());
        }
    }

    @Test
    void carNamesFallBackAndColourSuffixIsTrimmed() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            buddy(f, "emp-a", 1);
            f.stock("n1", "released", car("BMW X1 in Red", "X1", "Red", "O1"));
            f.stock("n2", "released", car(null, "X3", null, "O2"));
            f.stock("n3", "released", "{\"facts\":{\"facts\":{}},\"release\":{\"availability\":{\"state\":\"available\"}}}");
            f.stock("n4", "released", car("BMW X1 in Blue", null, "Red", "O4"));
            f.stock("n5", "released", car("  ", null, "  ", " "));
            f.release("t1", "2026-11-13T08:00:00Z", "n1", "n2", "n3", "n4", "n5");
            Map<String, JsonNode> by = new HashMap<>();
            ok(f).get("cars").forEach(c -> by.put(c.get("id").asText(), c));
            assertEquals("BMW X1", by.get("n1").get("name").asText());
            assertEquals("Red", by.get("n1").get("colour").asText());
            assertEquals("O1", by.get("n1").get("orderNumber").asText());
            assertEquals("X3", by.get("n2").get("name").asText());
            assertTrue(by.get("n2").get("colour").isNull());
            assertEquals("Released car", by.get("n3").get("name").asText());
            assertTrue(by.get("n3").get("orderNumber").isNull());
            assertEquals("BMW X1 in Blue", by.get("n4").get("name").asText());
            assertEquals("Released car", by.get("n5").get("name").asText());
            assertTrue(by.get("n5").get("orderNumber").isNull());
        }
    }

    @Test
    void outcomesNamePeopleAndAssignedOtherCar() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            buddy(f, "emp-a", 1);
            buddy(f, "emp-b", 1);
            f.employee("emp-z");
            f.setEmployee("emp-z", "{\"name\":\"Zed\"}", 1);
            f.stock("car-1", "released", car(null, "X1", null, "O1"));
            f.stock("car-2", "released", car(null, "X1", null, "O2"));
            f.release("t1", "2026-11-13T08:00:00Z", "car-1", "car-2");
            f.records.decisions.add(new RecordedDecision("emp-a", "car-1", "eligible", num("90"), null, null, null,
                    "2026-11-13T09:00:00.000Z", 1L, DemandFixture.POLICY, null, 3L, 1L, "emp-z", false));
            f.records.decisions.add(new RecordedDecision("emp-a", "car-2", "eligible", num("50"), null, null, null,
                    "2026-11-13T09:00:00.000Z", 1L, DemandFixture.POLICY, null, 3L, 1L, null, true));
            f.records.decisions.add(new RecordedDecision("emp-b", "car-1", "eligible", num("40"), null, null, null,
                    "2026-11-13T09:00:00.000Z", 1L, DemandFixture.POLICY, null, 3L, 1L, "emp-b", false));
            ObjectNode v = ok(f);
            assertEquals(List.of("car-1", "car-2"), ids(v));
            assertEquals("assigned", cell(v, 0, 0).get("outcome").get("state").asText());
            assertEquals("emp-z", cell(v, 0, 0).get("outcome").get("employeeId").asText());
            assertEquals("assigned-other-car", cell(v, 1, 0).get("outcome").get("state").asText());
            assertEquals(0, cell(v, 0, 0).get("blockers").size());
            assertEquals(2, v.get("people").size());
            Map<String, String> names = new HashMap<>();
            v.get("people").forEach(p -> names.put(p.get("id").asText(), p.get("name").asText()));
            assertEquals("Zed", names.get("emp-z"));
            assertEquals("PRIVATE-NAME-emp-b", names.get("emp-b"));
        }
    }

    @Test
    void unavailablePortUnknownGateAndMissingCarAreTheSame503() throws Exception {
        try (DemandFixture f = one()) {
            f.records.absent = true;
            assertEquals("suitability-unavailable", unavailable(f.suitability().read(DemandFixture.SCOPE, 1, 1, "all")));
            f.records.absent = false;
            f.records.decisions.add(decision("emp-a", "car-1", "maybe", num("1")));
            assertEquals("suitability-unavailable", unavailable(f.suitability().read(DemandFixture.SCOPE, 1, 1, "all")));
            f.records.decisions.clear();
            assertNotNull(ok(f));
            f.release("t2", "2026-11-13T09:00:00Z", "no-such-car");
            assertEquals("suitability-unavailable", unavailable(f.suitability().read(DemandFixture.SCOPE, 1, 1, "all")));
            assertEquals("suitability-unavailable", unavailable(f.suitability().read(DemandFixture.SCOPE, 1, 1, "latest")));
        }
    }

    @Test
    void aThrowingPortOrMalformedReleaseIs503() throws Exception {
        try (DemandFixture f = one()) {
            AllocationRecordsPort boom = (c, s, e, o) -> {
                throw new SQLException("down");
            };
            assertEquals("suitability-unavailable", unavailable(with(f, f.policy, boom).read(DemandFixture.SCOPE, 1, 1, "all")));
            f.update("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, input_digest, state, "
                    + "last_outcome) VALUES (?, ?, 'tk', now(), 99, ?, 'completed', '{}'::jsonb)", DemandFixture.ENV, DemandFixture.RUN,
                    "c".repeat(64));
            f.update("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, tick_id, released_at, policy_version, "
                    + "source, input_digest, order_uuids, visible_order_uuids, outcome) VALUES (?, ?, 'bad', 'w', 'tk', "
                    + "now() + interval '1 day', ?, '{}'::jsonb, ?, '[1]'::jsonb, '[]'::jsonb, '{}'::jsonb)", DemandFixture.ENV,
                    DemandFixture.RUN, DemandFixture.POLICY, "d".repeat(64));
            assertEquals("suitability-unavailable", unavailable(f.suitability().read(DemandFixture.SCOPE, 1, 1, "all")));
        }
    }

    @Test
    void aRetiredOrMissingRunIsStale() throws Exception {
        try (DemandFixture f = one()) {
            DemandScope missing = new DemandScope(DemandFixture.ENV, "run-none", DemandFixture.POLICY);
            assertEquals("stale-run", refusal(f.suitability().read(missing, 1, 1, "all")).code());
            f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE environment_id = ? AND run_id = ?",
                    DemandFixture.ENV, DemandFixture.RUN);
            DemandResult.Refusal r = refusal(f.suitability().read(DemandFixture.SCOPE, 1, 1, "all"));
            assertEquals(409, r.http());
            assertEquals("stale-run", r.code());
            assertFalse(r.retryable());
        }
    }

    @Test
    void theDefaultPortRecordsNothingSoEveryCellIsNotEvaluated() throws Exception {
        try (DemandFixture f = one()) {
            DemandDefaults.NoAllocationRecords none = new DemandDefaults.NoAllocationRecords();
            assertEquals(List.of(), none.read(null, DemandFixture.SCOPE, List.of("a"), List.of("b")).orElseThrow());
            ObjectNode v = value(with(f, f.policy, none).read(DemandFixture.SCOPE, 1, 1, "all"));
            assertEquals(j("{\"employeeId\":\"emp-a\",\"state\":\"not-evaluated\"}"), cell(v, 0, 0));
            assertEquals(0, v.get("people").size());
        }
    }

    @Test
    void statementCountIsFixedAndDoesNotGrowWithTheRun() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            buddy(f, "emp-a", 1);
            f.employee("holder");
            String[] ids = new String[40];
            for (int i = 0; i < ids.length; i++) {
                ids[i] = "car-" + i;
                f.stock(ids[i], "released", car(null, "X1", null, "O" + i));
            }
            f.release("t1", "2026-11-13T08:00:00Z", ids);
            f.hold("h1", "car-0", "holder", "cart", "active");
            AtomicInteger statements = new AtomicInteger();
            SuitabilityService s = with(f, f.policy, f.records);
            SuitabilityService counted = new SuitabilityService(counting(f.pool(), statements), f.policy, f.records,
                    Clock.fixed(DemandFixture.NOW, ZoneOffset.UTC));
            assertNotNull(value(counted.read(DemandFixture.SCOPE, 1, 1, "all")));
            int small = statements.get();
            String[] more = new String[360];
            for (int i = 0; i < more.length; i++) {
                more[i] = "more-" + i;
                f.stock(more[i], "released", car(null, "X1", null, "M" + i));
            }
            f.release("t2", "2026-11-13T09:00:00Z", more);
            statements.set(0);
            assertNotNull(value(counted.read(DemandFixture.SCOPE, 1, 1, "all")));
            int large = statements.get();
            System.out.println("suitability statements per read: " + small + " with a hold name lookup, " + large + " without");
            assertTrue(small <= 8 && large <= small, "statements: " + small + " / " + large);
            assertNotNull(s);
        }
    }

    private static DataSource counting(DataSource ds, AtomicInteger n) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class}, (p, m, a) -> {
            Object r;
            try {
                r = m.invoke(ds, a);
            } catch (InvocationTargetException e) {
                throw e.getCause();
            }
            if (!"getConnection".equals(m.getName())) return r;
            Connection c = (Connection) r;
            return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class}, (p2, m2, a2) -> {
                if ("prepareStatement".equals(m2.getName()) || "createStatement".equals(m2.getName())) n.incrementAndGet();
                try {
                    return m2.invoke(c, a2);
                } catch (InvocationTargetException e) {
                    throw e.getCause();
                }
            });
        });
    }
}
